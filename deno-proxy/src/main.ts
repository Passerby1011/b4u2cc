import { serve } from "https://deno.land/std/http/server.ts";
import { loadConfig, ProxyConfig } from "./config.ts";
import { log, logRequest, closeRequestLog } from "./logging.ts";
import { mapClaudeToOpenAI } from "./anthropic_to_openai.ts";
import { injectPrompt } from "./prompt_inject.ts";
import { selectUpstreamConfig, callUpstream } from "./upstream.ts";
import { ToolifyParser } from "./parser.ts";
import { ClaudeStream } from "./openai_to_claude.ts";
import { SSEWriter } from "./sse.ts";
import { ClaudeRequest } from "./types.ts";
import { RateLimiter } from "./rate_limiter.ts";
import { randomTriggerSignal } from "./signals.ts";
import { countTokens } from "./token_counter.ts";

function extractDeltaText(delta: Record<string, unknown> | undefined): string {
  if (!delta) return "";
  const content = (delta as Record<string, unknown>).content;
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part) {
        return String((part as Record<string, unknown>).text ?? "");
      }
      return "";
    }).join("");
  }
  if (typeof content === "object" && content !== null && "text" in content) {
    return String((content as Record<string, unknown>).text ?? "");
  }
  return "";
}

const config = loadConfig();
const rateLimiter = new RateLimiter(config.maxRequestsPerMinute, 60_000);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function unauthorized() {
  return jsonResponse({ error: "unauthorized" }, 401);
}

function extractClientApiKey(req: Request): string | undefined {
  const header = req.headers.get("x-api-key") || req.headers.get("authorization");
  if (!header) return undefined;
  let key: string;
  if (header.startsWith("Bearer ")) {
    key = header.slice(7).trim();
  } else {
    key = header.trim();
  }
  return key || undefined;
}

function validateClientKey(req: Request, config: ProxyConfig): boolean {
  if (!config.clientApiKey) return true;
  const clientKey = extractClientApiKey(req);
  if (!clientKey) return false;
  return clientKey === config.clientApiKey;
}

async function handleMessages(req: Request, requestId: string) {
  if (!validateClientKey(req, config)) {
    return unauthorized();
  }

  let body: ClaudeRequest;
  let rawBody = "";
  try {
    rawBody = await req.text();
    body = JSON.parse(rawBody);
    await logRequest(requestId, "debug", "Received Claude request body", {
      rawPreview: body,
    });
  } catch {
    return jsonResponse({ error: "invalid JSON body" }, 400);
  }

  try {
    // 计算 input tokens
    const tokenCount = await countTokens(body, config, requestId);
    await logRequest(requestId, "info", "Token count calculated", {
      input_tokens: tokenCount.input_tokens, // 使用最新官方 API 字段名
      token_count: tokenCount.token_count, // 保持向后兼容
      tokens: tokenCount.tokens, // 保持向后兼容
      output_tokens: tokenCount.output_tokens,
    });

    // 工具解析仅由是否传入 tools 决定：存在 tools 时启用工具协议，否则禁用。
    const hasTools = (body.tools ?? []).length > 0;
    const triggerSignal = hasTools ? randomTriggerSignal() : undefined;
    // 选择上游配置
    const upstreamConfig = selectUpstreamConfig(config, body.model);
    const openaiBase = mapClaudeToOpenAI(body, upstreamConfig.requestModel, triggerSignal);
    const injected = injectPrompt(openaiBase, body.tools ?? [], triggerSignal);
    const upstreamReq = { ...openaiBase, messages: injected.messages };

    await rateLimiter.acquire();

    // 如果启用了透传，提取客户端 API key
    // 逻辑：只有当客户端提供的 key 存在且不等于代理自身的 clientApiKey 时，才进行透传
    const rawClientKey = extractClientApiKey(req);
    const clientApiKey = (config.passthroughApiKey && rawClientKey && rawClientKey !== config.clientApiKey)
      ? rawClientKey
      : undefined;

    const upstreamRes = await callUpstream(
      upstreamReq,
      upstreamConfig,
      config.requestTimeoutMs,
      requestId,
      clientApiKey,
    );
    await logRequest(requestId, "info", "Upstream responded", {
      status: upstreamRes.status,
      url: upstreamConfig.baseUrl,
      usingPassthroughApiKey: !!clientApiKey,
    });

    if (!upstreamRes.ok) {
      const errorText = await upstreamRes.text();
      await logRequest(requestId, "warn", "Upstream returned non-success status", {
        status: upstreamRes.status,
        bodyPreview: errorText,
      });
      await closeRequestLog(requestId);
      return jsonResponse(
        { error: "upstream_error", status: upstreamRes.status, body: errorText },
        502,
      );
    }

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const writer = new SSEWriter(controller, requestId);
        const claudeStream = new ClaudeStream(writer, config, requestId, tokenCount.input_tokens || tokenCount.token_count || tokenCount.tokens);
        // 发送 message_start 事件（完全按照官方格式）
        await claudeStream.init();
        const thinkingEnabled = !!body.thinking && body.thinking.type === "enabled";
        const parser = new ToolifyParser(injected.triggerSignal, thinkingEnabled);
        const decoder = new TextDecoder();
        const reader = upstreamRes.body!.getReader();
        let sseBuffer = "";
        let upstreamClosed = false;

        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            const text = decoder.decode(value, { stream: true });
            // 这里的调试日志量非常大，如果使用 await 会严重拖慢流式转发
            logRequest(requestId, "debug", "Upstream stream chunk", {
              chunkPreview: text,
              chunkLength: text.length,
            });
            sseBuffer += text;
            while (true) {
              const eventBoundary = sseBuffer.indexOf("\n\n");
              if (eventBoundary === -1) break;
              const rawEvent = sseBuffer.slice(0, eventBoundary);
              sseBuffer = sseBuffer.slice(eventBoundary + 2);
              const dataLines = rawEvent
                .split("\n")
                .map((line) => line.trim())
                .filter((line) => line.startsWith("data:"))
                .map((line) => line.slice(5).trim());
              if (!dataLines.length) continue;
              const payload = dataLines.join("\n");
              if (payload === "[DONE]") {
                upstreamClosed = true;
                break;
              }
              try {
                const json = JSON.parse(payload);
                // 同样避免在解析后的调试日志上阻塞流式
                logRequest(requestId, "debug", "Parsed upstream SSE event", {
                  fullEvent: json,
                  choices: json?.choices,
                });
                const delta = json?.choices?.[0]?.delta;
                const deltaText = extractDeltaText(delta);
                logRequest(requestId, "debug", "Extracted delta text", {
                  deltaText,
                  deltaTextLength: deltaText.length,
                  rawDelta: delta,
                });
                if (deltaText) {
                  for (const char of deltaText) {
                    parser.feedChar(char);
                    await claudeStream.handleEvents(parser.consumeEvents());
                  }
                }
              } catch (error) {
                await logRequest(requestId, "warn", "Failed to parse upstream SSE payload", {
                  error: String(error),
                  payloadPreview: payload,
                });
              }
            }
            if (upstreamClosed) break;
          }
          parser.finish();
          await claudeStream.handleEvents(parser.consumeEvents());
          await logRequest(requestId, "info", "Completed streaming response", {});
          await closeRequestLog(requestId);
        } catch (error) {
          await logRequest(requestId, "error", "Streaming failure", { error: String(error) });
          await closeRequestLog(requestId);
          controller.error(error);
          return;
        } finally {
          writer.close();
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "connection": "keep-alive",
      },
    });
  } catch (error) {
    await logRequest(requestId, "error", "Failed to process request", { error: String(error) });
    await closeRequestLog(requestId);
    return jsonResponse({ error: "internal_error", details: String(error) }, 500);
  }
}

async function handleTokenCount(req: Request, requestId: string) {
  if (!validateClientKey(req, config)) {
    return unauthorized();
  }

  let body: ClaudeRequest;
  let rawBody = "";
  try {
    rawBody = await req.text();
    body = JSON.parse(rawBody);
    await logRequest(requestId, "debug", "Received Claude token count request body", {
      rawPreview: body,
    });
  } catch {
    return jsonResponse({ error: "invalid JSON body" }, 400);
  }

  try {
    // 计算 token 数量
    const tokenCount = await countTokens(body, config, requestId);
    await logRequest(requestId, "info", "Token count calculated", {
      input_tokens: tokenCount.input_tokens, // 使用最新官方 API 字段名
      token_count: tokenCount.token_count, // 保持向后兼容
      tokens: tokenCount.tokens, // 保持向后兼容
      output_tokens: tokenCount.output_tokens,
    });

    return jsonResponse({
      input_tokens: tokenCount.input_tokens, // 使用最新官方 API 字段名
      token_count: tokenCount.token_count, // 保持向后兼容
      tokens: tokenCount.tokens, // 保持向后兼容
      output_tokens: tokenCount.output_tokens,
    });
  } catch (error) {
    await logRequest(requestId, "error", "Failed to count tokens", { error: String(error) });
    await closeRequestLog(requestId);
    return jsonResponse({ error: "token_count_error", details: String(error) }, 500);
  }
}

// 导出 handler 函数供 deploy.ts 使用
export const handler = (req: Request) => {
  const url = new URL(req.url);

  if (req.method === "GET" && url.pathname === "/") {
    const html = `<!DOCTYPE html>
<html>
<head>
  <title>Deno Proxy</title>
</head>
<body>
  <h1>Deno Proxy Server</h1>
  <p>Server is running</p>
</body>
</html>`;
    return new Response(html, {
      status: 200,
      headers: { "content-type": "text/html" }
    });
  }

  if (req.method === "GET" && url.pathname === "/healthz") {
    return jsonResponse({ status: "ok" });
  }

  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type,authorization,x-api-key",
      },
    });
  }

  if (req.method === "POST" && url.pathname === "/v1/messages") {
    const requestId = crypto.randomUUID();
    log("info", "Handling Claude message", { requestId });
    return handleMessages(req, requestId);
  }

  if (req.method === "POST" && url.pathname === "/v1/messages/count_tokens") {
    const requestId = crypto.randomUUID();
    log("info", "Handling Claude token count request", { requestId });
    return handleTokenCount(req, requestId);
  }

  console.log(`404 - ${req.method} ${url.pathname}`);
  return new Response("Not Found", { status: 404 });
};

// 如果是直接运行此文件（而不是被导入），则启动服务器
if (import.meta.main) {
  serve(handler, config.autoPort ? undefined : { hostname: config.host, port: config.port });
}
