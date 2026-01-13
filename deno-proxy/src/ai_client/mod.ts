/**
 * AI Client 模块统一导出
 *
 * 提供统一的 AI 请求客户端接口
 */

// 核心类
export { RequestContext } from "./request_context.ts";
export { AIClient } from "./ai_client.ts";
export { ContextBuilder } from "./context_builder.ts";

// 协议适配器
export {
  ProtocolAdapter,
  OpenAIAdapter,
  AnthropicAdapter,
  GeminiAdapter,
  ProtocolAdapterFactory,
} from "./protocol_adapter.ts";

// 工具调用策略
export {
  ToolCallStrategy,
  PromptInjectionStrategy,
  NativeToolCallStrategy,
  AutoStrategy,
  ToolCallStrategyFactory,
} from "./tool_call_strategy.ts";

// 日志记录器
export { AIClientLogger, createLogger, logSystem } from "./logger.ts";

// 类型定义
export type {
  Protocol,
  ToolCallMode,
  RequestFormat,
  UpstreamConfig,
  AIRequestOptions,
  AIResponse,
  StreamChunk,
  StreamCallback,
  RequestContextData,
  LogLevel,
  LogMetadata,
  PerformanceMetrics,
} from "./types.ts";
