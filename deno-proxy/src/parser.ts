import { ParsedInvokeCall, ParserEvent } from "./types.ts";
import { log, logPhase, LogPhase } from "./logging.ts";
import { ToolCallDelimiter } from "./signals.ts";

// 思考标签常量
const THINKING_START_TAG = "<thinking>";
const THINKING_END_TAG = "</thinking>";

type ParserState = "TEXT" | "THINKING" | "TOOL";

export class ToolifyParser {
  private readonly delimiter?: ToolCallDelimiter;
  private readonly thinkingEnabled: boolean;
  
  private state: ParserState = "TEXT";
  private buffer = ""; // 通用缓冲区
  private thinkingBuffer = "";
  private toolBuffer = "";
  private textBeforeToolCall = ""; // 🔑 记录工具调用前的所有文本
  
  private readonly events: ParserEvent[] = [];
  private readonly requestId?: string;

  private tryParseJson(str: string): any {
    if (!str) return {};
    try {
      return JSON.parse(str);
    } catch (_e) {
      // 容错：尝试提取第一个 { 和最后一个 } 之间的内容
      const firstBrace = str.indexOf("{");
      const lastBrace = str.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        const candidate = str.slice(firstBrace, lastBrace + 1);
        try {
          return JSON.parse(candidate);
        } catch (_e2) {
          // 进一步容错：处理常见的 JSON 错误（简单版）
          try {
            // 替换未转义的换行符
            const fixed = candidate
              .replace(/\n/g, "\\n")
              .replace(/\r/g, "\\r");
            return JSON.parse(fixed);
          } catch (_e3) {
            return null;
          }
        }
      }
      return null;
    }
  }

  constructor(delimiter?: ToolCallDelimiter, thinkingEnabled = false, requestId?: string) {
    this.delimiter = delimiter;
    this.thinkingEnabled = thinkingEnabled;
    this.requestId = requestId;
  }

  feedReasoning(content: string) {
    if (content) {
      this.events.push({ type: "thinking", content });
    }
  }

  feedChar(char: string) {
    this.buffer += char;
    this.processBuffer();
  }

  private processBuffer() {
    const m = this.delimiter?.getMarkers();

    if (this.state === "THINKING") {
      // 思考模式中：只寻找结束标签
      if (this.buffer.includes(THINKING_END_TAG)) {
        const idx = this.buffer.indexOf(THINKING_END_TAG);
        this.thinkingBuffer += this.buffer.slice(0, idx);
        
        // 发出思考事件
        let content = this.thinkingBuffer.replace(/^\s*>\s*/, "");
        if (content) {
          this.events.push({ type: "thinking", content });
        }
        
        // 切换回文本模式
        this.thinkingBuffer = "";
        this.state = "TEXT";
        // 剩余部分重新处理
        const remaining = this.buffer.slice(idx + THINKING_END_TAG.length);
        this.buffer = "";
        if (remaining) {
          this.feedChar(""); // 触发递归处理，但其实直接赋值 buffer 更安全
          this.buffer = remaining;
          this.processBuffer();
        }
      }
      // 如果没找到结束标签，buffer 继续增长
      return;
    }

    if (this.state === "TOOL") {
      // 工具模式中：寻找结束标记
      if (m && this.buffer.includes(m.TC_END)) {
        const idx = this.buffer.indexOf(m.TC_END) + m.TC_END.length;
        this.toolBuffer += this.buffer.slice(0, idx);
        
        this.parseAndEmitToolCall();
        
        this.state = "TEXT";
        const remaining = this.buffer.slice(idx);
        this.buffer = "";
        if (remaining) {
          this.buffer = remaining;
          this.processBuffer();
        }
      }
      return;
    }

    // TEXT 状态：寻找思考开始或工具开始
    
    // 1. 优先检测思考开始 (如果启用)
    if (this.thinkingEnabled && this.buffer.includes(THINKING_START_TAG)) {
      const idx = this.buffer.indexOf(THINKING_START_TAG);
      const textBefore = this.buffer.slice(0, idx);
      if (textBefore) {
        this.events.push({ type: "text", content: textBefore });
      }
      
      this.state = "THINKING";
      this.thinkingBuffer = "";
      const remaining = this.buffer.slice(idx + THINKING_START_TAG.length);
      this.buffer = "";
      if (remaining) {
        this.buffer = remaining;
        this.processBuffer();
      }
      return;
    }

    // 2. 检测工具调用开始
    if (m && this.buffer.includes(m.TC_START)) {
      const idx = this.buffer.indexOf(m.TC_START);
      const textBefore = this.buffer.slice(0, idx);
      if (textBefore) {
        this.textBeforeToolCall += textBefore; // 🔑 累积前置文本
        this.events.push({ type: "text", content: textBefore });
      }
      
      this.state = "TOOL";
      this.toolBuffer = ""; // TC_START 留在 buffer 里交给 TOOL 状态处理
      const remaining = this.buffer.slice(idx);
      this.buffer = "";
      if (remaining) {
        this.buffer = remaining;
        this.processBuffer();
      }
      return;
    }

    // 3. 保护逻辑：如果 buffer 太长且没有发现任何标记，刷出部分文本
    // 但要保留可能成为标记一部分的后缀
    const maxMarkerLen = Math.max(
      THINKING_START_TAG.length,
      m?.TC_START.length || 0
    );
    
    if (this.buffer.length > 512) {
      const safeLen = this.buffer.length - maxMarkerLen;
      const safeText = this.buffer.slice(0, safeLen);
      this.events.push({ type: "text", content: safeText });
      this.buffer = this.buffer.slice(safeLen);
    }
  }

  finish() {
    if (this.state === "THINKING") {
      let content = this.thinkingBuffer + this.buffer;
      content = content.replace(/^\s*>\s*/, "");
      if (content) {
        this.events.push({ type: "thinking", content });
      }
    } else if (this.state === "TOOL") {
      this.toolBuffer += this.buffer;
      this.parseAndEmitToolCall(); // 🔑 尝试解析，可能发出 tool_call_failed 事件
    } else {
      if (this.buffer) {
        this.textBeforeToolCall += this.buffer; // 🔑 累积文本模式下的内容
        this.events.push({ type: "text", content: this.buffer });
      }
    }

    this.events.push({ type: "end" });
    
    // 重置
    this.state = "TEXT";
    this.buffer = "";
    this.thinkingBuffer = "";
    this.toolBuffer = "";
    this.textBeforeToolCall = "";
  }

  consumeEvents(): ParserEvent[] {
    return this.events.splice(0, this.events.length);
  }

  private parseAndEmitToolCall() {
    if (!this.delimiter) return;
    const m = this.delimiter.getMarkers();
    const content = this.toolBuffer;

    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // 更加宽松的正则表达式：允许在标记之间存在任意空白符（包括缩进）
    const regex = new RegExp(
      `${esc(m.TC_START)}[\\s\\S]*?` +
        `${esc(m.NAME_START)}\\s*([\\s\\S]*?)\\s*${esc(m.NAME_END)}[\\s\\S]*?` +
        `${esc(m.ARGS_START)}\\s*([\\s\\S]*?)\\s*${esc(m.ARGS_END)}[\\s\\S]*?` +
        `${esc(m.TC_END)}`,
      "g"
    );

    let found = false;
    let match: RegExpExecArray | null;
    let name = "";
    let argsStr = "";

    // 1. 尝试正则匹配
    if ((match = regex.exec(content)) !== null) {
      name = match[1].trim();
      argsStr = match[2].trim();
    } else {
      // 2. 如果正则匹配失败，尝试基于关键标记定位的"模糊匹配"
      const nStart = content.indexOf(m.NAME_START);
      const nEnd = content.indexOf(m.NAME_END, nStart + m.NAME_START.length);
      const aStart = content.indexOf(m.ARGS_START, nEnd + m.NAME_END.length);
      const aEnd = content.indexOf(m.ARGS_END, aStart + m.ARGS_START.length);

      if (nStart !== -1 && nEnd !== -1 && aStart !== -1 && aEnd !== -1) {
        name = content.slice(nStart + m.NAME_START.length, nEnd).trim();
        argsStr = content.slice(aStart + m.ARGS_START.length, aEnd).trim();
        log("debug", "Regex failed, but fuzzy marker matching succeeded", { name, requestId: this.requestId });
      }
    }

    if (name) {
      // 尝试解析或修复 JSON
      const args = this.tryParseJson(argsStr);
      if (args !== null) {
        logPhase(this.requestId || "unknown", LogPhase.TOOL, `${name}()`, {
          args: argsStr.slice(0, 100) + (argsStr.length > 100 ? "..." : ""),
        });

        this.events.push({
          type: "tool_call",
          call: { name, arguments: args },
        });
        found = true;
      } else {
        log("warn", "Failed to parse tool call arguments even after repair", {
          name,
          argsStr: argsStr.slice(0, 1000),
          requestId: this.requestId,
        });
      }
    }

    if (!found) {
      // 🔑 确定失败原因
      const reason = content.includes(m.TC_END) ? "malformed_json" : "incomplete_delimiter";
      
      log("warn", "No valid tool call found in tool buffer", {
        requestId: this.requestId,
        reason,
        bufferSize: content.length,
        bufferPreview: content.slice(0, 1000),
      });
      
      // 🔑 发出 tool_call_failed 事件而不是降级为文本
      this.events.push({ 
        type: "tool_call_failed", 
        content,
        reason,
        priorText: this.textBeforeToolCall
      });
    } else {
      const lastMatchEnd = regex.lastIndex;
      const remaining = content.slice(lastMatchEnd);
      if (remaining.trim()) {
        this.events.push({ type: "text", content: remaining });
      }
    }
    
    this.toolBuffer = "";
  }
}

