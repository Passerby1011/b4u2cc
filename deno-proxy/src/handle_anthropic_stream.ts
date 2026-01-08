import { ToolifyParser } from "./parser.ts";
import { ClaudeStream } from "./claude_writer.ts";
import { SSEWriter } from "./sse.ts";
import { ProxyConfig } from "./config.ts";
import { log } from "./logging.ts";
import { ToolCallDelimiter } from "./signals.ts";
import { ToolCallRetryHandler } from "./tool_retry.ts";

export async function handleAnthropicStream(
  response: Response,
  writer: SSEWriter,
  config: ProxyConfig,
  requestId: string,
  delimiter?: ToolCallDelimiter,
  thinkingEnabled = false,
  inputTokens = 0,
  model = "claude-3-5-sonnet-20241022",
  originalMessages: any[] = [],
  upstreamUrl = "",
  upstreamHeaders: Record<string, string> = {},
  protocol: "openai" | "anthropic" = "anthropic",
) {
  const parser = new ToolifyParser(delimiter, thinkingEnabled, requestId);
  const claudeStream = new ClaudeStream(writer, config, requestId, inputTokens, model);

  await claudeStream.init();

  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      let readResult;
      try {
        readResult = await reader.read();
      } catch (readError) {
        log("error", "Stream read error", {
          error: String(readError),
          requestId
        });
        // 通知客户端发生了流读取错误
        await writer.send({
          event: "error",
          data: {
            error: {
              type: "stream_error",
              message: "Failed to read from upstream: " + String(readError)
            }
          }
        }, true);
        break;
      }

      const { done, value } = readResult;
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      let eventType = "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (trimmed.startsWith("event: ")) {
          eventType = trimmed.slice(7);
        } else if (trimmed.startsWith("data: ")) {
          const jsonStr = trimmed.slice(6);
          try {
            const data = JSON.parse(jsonStr);

            // 处理不同类型的 Anthropic 事件
            if (eventType === "content_block_delta") {
              const delta = data.delta;
              if (delta?.type === "text_delta") {
                const text = delta.text;
                if (text) {
                  for (const char of text) {
                    parser.feedChar(char);
                    await claudeStream.handleEvents(parser.consumeEvents());
                  }
                }
              }
            } else if (eventType === "message_start") {
              // 可以在这里更新 input_tokens，如果上游返回了更精确的值
            } else if (eventType === "message_delta") {
              // 处理结束状态等
            }
          } catch (e) {
            log("error", "Failed to parse Anthropic SSE chunk", { error: String(e), jsonStr });
          }
        }
      }
    }

    parser.finish();
    const events = parser.consumeEvents();
    const failedEvent = events.find(e => e.type === "tool_call_failed");

    // 🔑 检测到工具调用失败 + 重试已启用
    if (failedEvent && 
        config.toolCallRetry?.enabled && 
        delimiter &&
        originalMessages.length > 0 &&
        upstreamUrl) {
      
      // 🔑 保持连接：发送心跳
      if (config.toolCallRetry?.keepAlive !== false) {
        await writer.send({
          event: "ping",
          data: { type: "ping" }
        });
      }

      const maxRetries = config.toolCallRetry?.maxRetries || 1;
      let retrySuccess = false;

      // 重试循环
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const retryHandler = new ToolCallRetryHandler(
          config,
          requestId,
          originalMessages,
          upstreamUrl,
          upstreamHeaders,
          protocol,
          model  // 🔑 传递原始请求的模型
        );

        const retryResult = await retryHandler.retry(
          failedEvent.content,
          failedEvent.priorText || "",
          delimiter,
          attempt
        );

        if (retryResult.success) {
          // 🔑 重试成功：发送工具调用事件
          await claudeStream.handleEvents([{
            type: "tool_call",
            call: retryResult.result!
          }]);
          retrySuccess = true;
          break;
        } else if (attempt < maxRetries) {
          // 继续下一次重试
          log("info", "Retry attempt failed, will retry again", {
            requestId,
            attempt,
            maxRetries,
            error: retryResult.error
          });
          
          // 🔑 保持连接：再次发送心跳
          if (config.toolCallRetry?.keepAlive !== false) {
            await writer.send({
              event: "ping",
              data: { type: "ping" }
            });
          }
        }
      }

      if (!retrySuccess) {
        // 🔑 所有重试都失败：降级为文本
        log("error", "All retry attempts exhausted, falling back to text", {
          requestId,
          totalAttempts: maxRetries
        });
        
        await claudeStream.handleEvents([{
          type: "text",
          content: failedEvent.content
        }]);
      }
    } else {
      // 正常处理事件
      await claudeStream.handleEvents(events);
    }
  } catch (e) {
    log("error", "Error in Anthropic stream handling", { error: String(e), requestId });
    // 尝试通知客户端发生了错误
    try {
      await writer.send({
        event: "error",
        data: {
          error: {
            type: "stream_error",
            message: String(e)
          }
        }
      }, true);
    } catch {
      // 忽略发送错误时的异常
    }
  } finally {
    reader.releaseLock();
  }
  
  return { outputTokens: claudeStream.getTotalOutputTokens() };
}
