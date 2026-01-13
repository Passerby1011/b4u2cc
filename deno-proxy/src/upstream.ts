import { ProxyConfig } from "./config.ts";
import { SSEWriter } from "./sse.ts";
import { logPhase, LogPhase } from "./logging.ts";
import { handleOpenAIStream } from "./handle_openai_stream.ts";
import { handleAnthropicStream } from "./handle_anthropic_stream.ts";
import { countTokensLocally } from "./token_counter.ts";
import { RequestContext } from "./ai_client/mod.ts";

export async function forwardRequest(
  context: RequestContext,
  writer: SSEWriter | undefined,
  abortSignal?: AbortSignal,
) {
  // 从 RequestContext 获取所有必要信息
  const requestId = context.getRequestId();
  const config = context.getConfig();
  const upstreamConfig = context.getUpstreamConfig();
  const enrichedRequest = context.getEnrichedRequest();
  const originalRequest = context.getOriginalRequest();
  const delimiter = context.getDelimiter();
  const clientApiKey = context.getClientApiKey();

  // 记录工具注入信息
  if (delimiter && originalRequest.tools && originalRequest.tools.length > 0) {
    logPhase(requestId, LogPhase.ENRICHED, `Injected ${originalRequest.tools.length} tools`, {
      delimiter: delimiter.getMarkers().TC_START,
    });
  }

  // 准备请求参数
  const isStream = originalRequest.stream === true;
  const protocol = upstreamConfig.protocol as "openai" | "anthropic";
  const requestModel = upstreamConfig.model;
  const baseUrl = upstreamConfig.baseUrl;

  logPhase(requestId, LogPhase.UPSTREAM, `Forwarding to ${protocol.toUpperCase()}`, {
    model: requestModel,
    url: baseUrl.split("/").pop(),
  });

  // 构建请求头（根据协议）
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (protocol === "openai") {
    if (upstreamConfig.apiKey) {
      headers["Authorization"] = `Bearer ${upstreamConfig.apiKey}`;
    }
  } else {
    if (upstreamConfig.apiKey) {
      headers["x-api-key"] = upstreamConfig.apiKey;
    }
    headers["anthropic-version"] = "2023-06-01";
  }

  // 构建请求体
  let fetchBody: string;
  if (protocol === "openai") {
    // OpenAI 格式需要转换
    const { mapClaudeToOpenAI } = await import("./map_claude_to_openai.ts");
    const openaiReq = mapClaudeToOpenAI(enrichedRequest, requestModel);
    openaiReq.stream = isStream;
    fetchBody = JSON.stringify(openaiReq);
  } else {
    // Anthropic 格式
    const anthropicReq = {
      ...enrichedRequest,
      model: requestModel,
      stream: isStream,
    };
    fetchBody = JSON.stringify(anthropicReq);
  }

  // 发送请求
  const upstreamStartTime = Date.now();
  const response = await fetch(baseUrl, {
    method: "POST",
    headers,
    body: fetchBody,
    signal: abortSignal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    logPhase(requestId, LogPhase.ERROR, `Upstream failed (${response.status})`, {
      error: errorText.slice(0, 200),
    });
    throw new Error(`Upstream returned ${response.status}: ${errorText}`);
  }

  const ttfb = Date.now() - upstreamStartTime;
  logPhase(requestId, LogPhase.STREAM, `Receiving response (TTFB: ${ttfb}ms)`);

  // 计算输入 Token
  const localUsage = await countTokensLocally(enrichedRequest, config, requestId);
  const inputTokens = localUsage.input_tokens;

  // 处理响应
  const thinkingEnabled = originalRequest.thinking?.type === "enabled";

  if (isStream && writer) {
    // 流式响应
    if (protocol === "openai") {
      const result = await handleOpenAIStream(
        response,
        writer,
        config,
        requestId,
        delimiter,
        thinkingEnabled,
        inputTokens,
        originalRequest,
        baseUrl,
        headers,
        protocol,
        clientApiKey,
        context, // 传递 RequestContext
      );
      return result;
    } else {
      const result = await handleAnthropicStream(
        response,
        writer,
        config,
        requestId,
        delimiter,
        thinkingEnabled,
        inputTokens,
        originalRequest,
        baseUrl,
        headers,
        protocol,
        clientApiKey,
        context, // 传递 RequestContext
      );
      return result;
    }
  } else {
    // 非流式响应
    const json = await response.json();
    return json;
  }
}
