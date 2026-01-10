/**
 * 工具调用拦截中间件
 * 在 AI 流式响应中检测工具调用，并在必要时拦截替换
 */

import { SSEWriter } from "../sse.ts";
import { log } from "../logging.ts";
import { ToolInterceptor } from "./tool_interceptor.ts";
import type { WebToolsConfig, FirecrawlConfig, UpstreamInfo } from "./types.ts";
import type { ClaudeMessage } from "../types.ts";

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * 工具调用拦截器
 * 在流式响应中检测并拦截 web_search 和 web_fetch 工具调用
 */
export class ToolUseInterceptor {
  private firecrawlConfig: FirecrawlConfig;
  private webToolsConfig: WebToolsConfig;
  private toolInterceptor: ToolInterceptor;
  private requestId: string;
  private messages: ClaudeMessage[];
  private upstreamInfo: UpstreamInfo;

  // 当前正在构建的工具调用
  private currentToolUse: Partial<ToolUseBlock> | null = null;
  private shouldInterceptCurrent = false;
  private inputJsonBuffer = ""; // 累积 input JSON 字符串

  constructor(
    firecrawlConfig: FirecrawlConfig,
    webToolsConfig: WebToolsConfig,
    requestId: string,
    messages: ClaudeMessage[],
    upstreamInfo: UpstreamInfo,
  ) {
    this.firecrawlConfig = firecrawlConfig;
    this.webToolsConfig = webToolsConfig;
    this.toolInterceptor = new ToolInterceptor(firecrawlConfig, webToolsConfig);
    this.requestId = requestId;
    this.messages = messages;
    this.upstreamInfo = upstreamInfo;
  }

  /**
   * 处理 content_block_start 事件
   * 检测是否需要拦截这个工具调用
   */
  async handleContentBlockStart(event: any, writer: SSEWriter): Promise<boolean> {
    const contentBlock = event.content_block;

    if (contentBlock?.type === "tool_use") {
      this.currentToolUse = {
        type: "tool_use",
        id: contentBlock.id,
        name: contentBlock.name,
        input: {},
      };
      this.inputJsonBuffer = ""; // 重置 buffer

      // 判断是否需要拦截
      const shouldIntercept = this.shouldInterceptToolUse(contentBlock.name);
      this.shouldInterceptCurrent = shouldIntercept;

      if (shouldIntercept) {
        log("info", `🚫 Intercepting tool_use: ${contentBlock.name}`, {
          requestId: this.requestId,
          toolId: contentBlock.id,
          toolName: contentBlock.name,
        });
        // 不转发给客户端
        return true; // true 表示已拦截
      }
    }

    // 不拦截，正常转发
    return false;
  }

  /**
   * 处理 content_block_delta 事件
   */
  async handleContentBlockDelta(event: any, writer: SSEWriter): Promise<boolean> {
    if (!this.shouldInterceptCurrent) {
      return false; // 不拦截
    }

    // 如果正在拦截，收集 input_json_delta
    if (event.delta?.type === "input_json_delta" && this.currentToolUse) {
      const partialJson = event.delta.partial_json;
      if (partialJson) {
        this.inputJsonBuffer += partialJson;
      }
    }

    return true; // 已拦截，不转发
  }

  /**
   * 处理 content_block_stop 事件
   * 如果拦截了工具调用，在这里执行真正的搜索/抓取
   */
  async handleContentBlockStop(event: any, writer: SSEWriter): Promise<boolean> {
    if (!this.shouldInterceptCurrent || !this.currentToolUse) {
      return false; // 不拦截
    }

    const toolName = this.currentToolUse.name;
    const toolId = this.currentToolUse.id;

    log("info", `🔧 Executing intercepted tool: ${toolName}`, {
      requestId: this.requestId,
      toolId,
      inputBuffer: this.inputJsonBuffer.substring(0, 100),
    });

    try {
      // 解析累积的 JSON 输入
      let parsedInput: Record<string, unknown> = {};
      if (this.inputJsonBuffer) {
        try {
          parsedInput = JSON.parse(this.inputJsonBuffer);
        } catch (e) {
          log("error", "Failed to parse tool input JSON", {
            requestId: this.requestId,
            error: String(e),
            buffer: this.inputJsonBuffer,
          });
        }
      }

      if (toolName === "web_search") {
        await this.executeWebSearch(writer, parsedInput);
      } else if (toolName === "web_fetch") {
        await this.executeWebFetch(writer, parsedInput);
      }
    } catch (error) {
      log("error", `Failed to execute intercepted tool: ${toolName}`, {
        requestId: this.requestId,
        error: String(error),
      });
      // 发送错误消息
      // TODO: 发送错误的 tool_result
    } finally {
      // 重置状态
      this.currentToolUse = null;
      this.shouldInterceptCurrent = false;
      this.inputJsonBuffer = "";
    }

    return true; // 已拦截
  }

  /**
   * 判断是否应该拦截这个工具
   */
  private shouldInterceptToolUse(toolName: string): boolean {
    if (toolName === "web_search" && this.webToolsConfig.enableSearchIntercept) {
      return true;
    }
    if (toolName === "web_fetch" && this.webToolsConfig.enableFetchIntercept) {
      return true;
    }
    return false;
  }

  /**
   * 执行 Web Search 拦截
   */
  private async executeWebSearch(writer: SSEWriter, input: Record<string, unknown>): Promise<void> {
    // 从 input 中提取搜索查询
    const query = input.query as string | undefined;

    if (!query) {
      log("error", "No query found in web_search input", {
        requestId: this.requestId,
        input,
      });
      return;
    }

    log("info", `🔍 Executing web search with query: ${query}`, {
      requestId: this.requestId,
    });

    const webSearchTool = {
      type: "web_search_20250305" as const,
      name: "web_search" as const,
      max_uses: 15,
      allowed_domains: input.allowed_domains as string[] | undefined,
      blocked_domains: input.blocked_domains as string[] | undefined,
    };

    // 执行搜索
    const searchResult = await this.toolInterceptor.handleWebSearch(
      webSearchTool,
      this.messages,
      this.upstreamInfo,
      this.requestId,
    );

    // 使用 StreamResponseWriter 输出结果
    const { StreamResponseWriter } = await import("./stream_response_writer.ts");

    // 获取模型名
    const model = this.upstreamInfo.model;

    // 判断是否使用智能模式
    const isSmartMode = this.webToolsConfig.searchMode === "smart";

    if (isSmartMode) {
      // 智能模式：流式输出分析
      await StreamResponseWriter.writeSmartSearchResponseStreaming(
        writer,
        model,
        async () => searchResult,
        async (onStreamChunk) => {
          await this.toolInterceptor.doStreamAnalysis(
            webSearchTool,
            searchResult,
            this.messages,
            this.upstreamInfo,
            this.requestId,
            onStreamChunk,
            // keepAlive 回调
            () => {
              // 发送心跳保持连接
              try {
                if (!writer.isClosed()) {
                  writer.send({ event: "ping", data: { type: "ping" } }, false);
                }
              } catch {
                // 忽略错误
              }
            },
          );
        },
      );
    } else {
      // 简单模式：直接输出搜索结果
      await StreamResponseWriter.writeSearchResponse(
        writer,
        searchResult,
        model,
      );
    }
  }

  /**
   * 执行 Web Fetch 拦截
   */
  private async executeWebFetch(writer: SSEWriter, input: Record<string, unknown>): Promise<void> {
    // 从 input 中提取 URL
    const url = input.url as string | undefined;

    if (!url) {
      log("error", "No URL found in web_fetch input", {
        requestId: this.requestId,
        input,
      });
      return;
    }

    log("info", `🌐 Executing web fetch for URL: ${url}`, {
      requestId: this.requestId,
    });

    const webFetchTool = {
      type: "web_fetch_20250910" as const,
      name: "web_fetch" as const,
    };

    const fetchResult = await this.toolInterceptor.handleWebFetch(
      webFetchTool,
      url,
      this.requestId,
    );

    // 使用 StreamResponseWriter 输出结果
    const { StreamResponseWriter } = await import("./stream_response_writer.ts");
    const model = this.upstreamInfo.model;

    await StreamResponseWriter.writeFetchResponse(
      writer,
      fetchResult,
      model,
    );
  }
}
