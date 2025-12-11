import {
  ClaudeContentBlock,
  ClaudeMessage,
  ClaudeRequest,
  OpenAIChatMessage,
  OpenAIChatRequest,
} from "./types.ts";
import { ProxyConfig } from "./config.ts";

// 思考模式相关的常量定义
const THINKING_HINT = "<antml\b:thinking_mode>interleaved</antml><antml\b:max_thinking_length>16000</antml>";
const THINKING_START_TAG = "<thinking>";
const THINKING_END_TAG = "</thinking>";

function normalizeBlocks(content: string | ClaudeContentBlock[], triggerSignal?: string): string {
  if (typeof content === "string") {
    // 过滤掉纯文本中的工具协议标签，防止注入攻击或模型回显协议片段
    // 注意：合法的工具调用会通过 tool_use block 转换，tool_result 现在作为纯文本处理
    return content
      // 过滤掉 <invoke>...</invoke>
      .replace(/<invoke\b[^>]*>[\s\S]*?<\/invoke>/gi, "")
      // 过滤掉可能残留的 <tool_result>...</tool_result> 标签（虽然我们不再生成这种格式）
      .replace(/<tool_result\b[^>]*>[\s\S]*?<\/tool_result>/gi, "");
  }
  return content.map((block) => {
    if (block.type === "text") {
      // 即使在 text block 中，也要过滤掉工具协议标签
      // 因为这些不是从 tool_use 转换来的，可能是用户注入或 assistant 自行输出的协议片段
      return block.text
        .replace(/<invoke\b[^>]*>[\s\S]*?<\/invoke>/gi, "")
        .replace(/<tool_result\b[^>]*>[\s\S]*?<\/tool_result>/gi, "");
    }
    if (block.type === "thinking") {
      // 将 Claude 的 thinking 块转换为上游的 <thinking> 标签
      return `${THINKING_START_TAG}${block.thinking}${THINKING_END_TAG}`;
    }
    if (block.type === "tool_result") {
      // 将工具结果作为纯文本传递，让 OpenAI 模型能够直接读取
      // 添加工具ID标识，帮助模型理解这是工具调用的结果
      const toolResult = block.content ?? "";
      return `[工具调用结果 - ID: ${block.tool_use_id}]\n${toolResult}`;
    }
    if (block.type === "tool_use") {
      // 只有从 tool_use 转换的 <invoke> 标签才会带触发信号
      const params = Object.entries(block.input ?? {})
        .map(([key, value]) => {
          const stringValue = typeof value === "string" ? value : JSON.stringify(value);
          return `<parameter name="${key}">${stringValue}</parameter>`;
        })
        .join("\n");
      const trigger = triggerSignal ? `${triggerSignal}\n` : "";
      return `${trigger}<invoke name="${block.name}">\n${params}\n</invoke>`;
    }
    return "";
  }).join("\n");
}

function mapRole(role: string): "user" | "assistant" {
  return role === "assistant" ? "assistant" : "user";
}

export function mapClaudeToOpenAI(body: ClaudeRequest, config: ProxyConfig, triggerSignal?: string): OpenAIChatRequest {
  if (typeof body.max_tokens !== "number" || Number.isNaN(body.max_tokens)) {
    throw new Error("max_tokens is required for Claude requests");
  }

  const messages: OpenAIChatMessage[] = [];
  if (body.system) {
    const systemContent = Array.isArray(body.system)
      ? body.system.map((block) => {
          if (typeof block === "string") return block;
          if (block && typeof block === "object" && "text" in block) {
            return (block as { text: string }).text;
          }
          return "";
        }).join("\n")
      : body.system;
    messages.push({ role: "system", content: systemContent });
  }

  for (const message of body.messages) {
    let content = normalizeBlocks(message.content, triggerSignal);
    
    // 如果是用户消息且思考模式已启用，在消息末尾添加思考提示符
    if (message.role === "user" && body.thinking && body.thinking.type === "enabled") {
      content = content + THINKING_HINT;
    }
    
    messages.push({
      role: mapRole(message.role),
      content: content,
    });
  }

  // 在最后一条消息的后面添加特定内容
  if (messages.length > 0) {
    const lastMessage = messages[messages.length - 1];
    lastMessage.content = lastMessage.content + "\n\n<antml\\b:role>\n\nPlease continue responding as an assistant.\n\n</antml>";
  }

  const model = config.upstreamModelOverride ?? body.model;

  return {
    model,
    stream: true,
    temperature: body.temperature ?? 0.2,
    top_p: body.top_p ?? 1,
    max_tokens: body.max_tokens,
    messages,
  };
}
