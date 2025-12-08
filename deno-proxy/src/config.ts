export interface ProxyConfig {
  port: number;
  host: string;
  upstreamBaseUrl: string;
  upstreamApiKey?: string;
  upstreamModelOverride?: string;
  clientApiKey?: string;
  requestTimeoutMs: number;
  aggregationIntervalMs: number;
  maxRequestsPerMinute: number;
  tokenMultiplier: number;
  autoPort: boolean;
}

// 解析 TOKEN_MULTIPLIER，兼容常见字符串形式：
// - "1.2" / "0.8"
// - "1.2x" / "x1.2"
// - "120%" （表示 1.2）
// - 带引号或空格的写法："'1.2'" / " 1.2 "
function parseTokenMultiplier(raw: string | undefined): number {
  if (!raw) return 1.0;

  let s = raw.trim();
  if (!s) return 1.0;

  // 去掉包裹的引号
  if ((s.startsWith("\"") && s.endsWith("\"")) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }

  // 支持百分号写法：120% -> 1.2
  if (s.endsWith("%")) {
    const num = parseFloat(s.slice(0, -1));
    if (Number.isFinite(num) && num > 0) {
      return num / 100;
    }
  }

  // 支持带 x 的写法：1.2x / x1.2
  if (s.toLowerCase().endsWith("x")) {
    s = s.slice(0, -1).trim();
  } else if (s.toLowerCase().startsWith("x")) {
    s = s.slice(1).trim();
  }

  const num = parseFloat(s);
  if (!Number.isFinite(num) || num <= 0) {
    return 1.0;
  }
  return num;
}

export function loadConfig(): ProxyConfig {
  const upstreamBaseUrl = Deno.env.get("UPSTREAM_BASE_URL") ?? "http://127.0.0.1:8000/v1/chat/completions";
  if (!upstreamBaseUrl) {
    throw new Error("UPSTREAM_BASE_URL must be provided");
  }

  // 检查是否启用自动端口配置
  const autoPort = Deno.env.get("AUTO_PORT") === "true";
  
  // 如果启用自动端口，则使用 0 让系统自动分配端口
  // 否则使用环境变量指定的端口或默认端口 3456
  const port = autoPort ? 0 : Number(Deno.env.get("PORT") ?? "3456");
  const host = Deno.env.get("HOST") ?? "0.0.0.0";
  const upstreamApiKey = Deno.env.get("UPSTREAM_API_KEY");
  const upstreamModelOverride = Deno.env.get("UPSTREAM_MODEL");
  const clientApiKey = Deno.env.get("CLIENT_API_KEY");
  const requestTimeoutMs = Number(Deno.env.get("TIMEOUT_MS") ?? "120000");
  const aggregationIntervalMs = Number(Deno.env.get("AGGREGATION_INTERVAL_MS") ?? "35");
  const maxRequestsPerMinute = Number(Deno.env.get("MAX_REQUESTS_PER_MINUTE") ?? "10");
  // 解析 tokenMultiplier，并对非法值进行兜底，避免出现 NaN/Infinity
  const tokenMultiplier = parseTokenMultiplier(Deno.env.get("TOKEN_MULTIPLIER"));

  return {
    port,
    host,
    upstreamBaseUrl,
    upstreamApiKey,
    upstreamModelOverride,
    clientApiKey,
    requestTimeoutMs,
    aggregationIntervalMs,
    maxRequestsPerMinute,
    tokenMultiplier,
    autoPort,
  };
}
