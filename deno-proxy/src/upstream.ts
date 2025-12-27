import { ProxyConfig, UpstreamConfig } from "./config.ts";
import { OpenAIChatRequest } from "./types.ts";
import { logRequest } from "./logging.ts";

/**
 * 解析客户端模型名，支持两种格式：
 * 1. 渠道+模型名：elysiver+claude-sonnet-4-5-20250929
 * 2. 普通模型名：claude-3.5-sonnet-20241022
 *
 * 返回 { channelName, modelName } 或 null（如果不是渠道+模型格式）
 */
function parseChannelModel(clientModel: string): { channelName: string; modelName: string } | null {
  const plusIndex = clientModel.indexOf("+");
  if (plusIndex === -1) {
    return null;
  }
  const channelName = clientModel.slice(0, plusIndex);
  const modelName = clientModel.slice(plusIndex + 1);
  return { channelName, modelName };
}

/**
 * 根据客户端请求的模型名选择上游配置。
 * 如果找到匹配的 nameModel，则返回对应的 UpstreamConfig；
 * 否则，如果存在旧配置（upstreamBaseUrl），则返回一个合成的 UpstreamConfig；
 * 否则抛出错误。
 */
export function selectUpstreamConfig(
  config: ProxyConfig,
  clientModel: string,
): UpstreamConfig {
  // 尝试解析渠道+模型名格式
  const channelModel = parseChannelModel(clientModel);
  if (channelModel) {
    // 查找匹配的渠道配置
    const channel = config.channelConfigs.find((c) => c.name === channelModel.channelName);
    if (channel) {
      return {
        baseUrl: channel.baseUrl,
        apiKey: channel.apiKey,
        requestModel: channelModel.modelName, // 透传模型名
        nameModel: clientModel, // 保留完整的客户端模型名
      };
    }
    // 如果没有找到渠道，继续尝试其他匹配方式
  }

  // 在多组配置中查找
  for (const upstreamConfig of config.upstreamConfigs) {
    if (upstreamConfig.nameModel === clientModel) {
      return upstreamConfig;
    }
  }

  // 如果没有多组配置，但存在旧配置，则使用旧配置
  if (config.upstreamBaseUrl) {
    return {
      baseUrl: config.upstreamBaseUrl,
      apiKey: config.upstreamApiKey,
      requestModel: config.upstreamModelOverride ?? clientModel,
      nameModel: clientModel,
    };
  }

  throw new Error(`No upstream configuration found for model "${clientModel}"`);
}

export async function callUpstream(
  upstreamReq: OpenAIChatRequest,
  upstreamConfig: UpstreamConfig,
  requestTimeoutMs: number,
  requestId: string,
  clientApiKey?: string, // 可选的客户端 API key
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  const headers = new Headers({
    "content-type": "application/json",
  });

  // 优先使用客户端透传的 API key，否则使用配置中的 API key
  const apiKey = clientApiKey || upstreamConfig.apiKey;
  if (apiKey) {
    headers.set("authorization", `Bearer ${apiKey}`);
  }

  await logRequest(requestId, "debug", "Sending upstream request", {
    url: upstreamConfig.baseUrl,
    upstreamRequestBody: upstreamReq,
  });

  let response: Response;
  try {
    response = await fetch(upstreamConfig.baseUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(upstreamReq),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  await logRequest(requestId, "debug", "Upstream response received", { status: response.status });
  if (!response.body) {
    throw new Error("Upstream response has no body");
  }

  return response;
}
