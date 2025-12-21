import { ClaudeToolDefinition, OpenAIChatMessage, OpenAIChatRequest } from "./types.ts";
import { randomTriggerSignal } from "./signals.ts";

const DEFAULT_TEMPLATE = `

You are an intelligent assistant equipped with specific tools. Your behavior changes based on the user's request type.

### 1. Available Tools
<antml:tools>
{tools_list}
</antml:tools>

### 2. Response Strategy (Execute vs. Chat)
You must assess the user request and choose ONE of the following modes immediately:

**MODE A: TOOL EXECUTION (Prioritize this for functionality)**
- **Trigger Condition:** If the request requires data fetching, file manipulation, calculation, or any action supported by your tools.
- **Behavior:** **BE SILENT AND ACT.** Do NOT explain what you are going to do. Do NOT say "I will check that for you."
- **Output:** Start immediately with the trigger signal "{trigger_signal}", followed by the XML block.
- **Constraint:** The XML must be the **ONLY** content of your response. Correctness is paramount.

**MODE B: CONVERSATION (Only when tools are useless)**
- **Trigger Condition:** If the user is greeting, asking for general advice, or asking a question that tools cannot solve.
- **Behavior:** Respond naturally and helpfully in plain text.
- **Constraint:** Do NOT output any trigger signals or XML tags in this mode.

### 3. Strict Tool Implementation Rules
If you enter **MODE A**, you must adhere to these technical rules:

1.  **Placement:** The XML block must be the **ABSOLUTE LAST** part of your response.
2.  **Trigger Signal:** Output "{trigger_signal}" on its own empty line immediately before the \`<invoke>\` tag.
3.  **Parameter Encoding:** 
    - Simple strings: Keep as text.
    - **Computex Logic (Arrays/Objects):** You MUST encode them as a valid JSON string inside the tag.
4.  **XML Structure:**
    Stick EXACTLY to this format:
    <antml:format>
    {trigger_signal}
    <invoke name="$TOOL_NAME">
    <parameter name="$PARAM_NAME">$VALUE_OR_JSON_STRING</parameter>
    </invoke>
    </antml:format>
5.  **Stop:** Stop generation immediately after the closing \`</invoke>\` tag.

### 4. Examples

**Case 1: Tool Needed (Direct Execution)**
User: "What is the weather in Shanghai?"
Assistant:
{trigger_signal}
<invoke name="GetWeather">
<parameter name="city">Shanghai</parameter>
</invoke>

**Case 2: Tool Needed (Complex Param / Code)**
User: "Write a python script to hello.py that prints 'Hello World'."
Assistant:
{trigger_signal}
<invoke name="WriteFile">
<parameter name="filename">hello.py</parameter>
<parameter name="content">print('Hello World')</parameter>
</invoke>

**Case 3: No Tool Needed (Normal Chat)**
User: "Hi, who are you?"
Assistant:
I am an AI assistant capable of using various tools to help you complete tasks. How can I assist you today?

  `;

function escapeText(text: string): string {
  return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildToolsXml(tools: ClaudeToolDefinition[]): string {
  if (!tools.length) return "<function_list>None</function_list>";
  const items = tools.map((tool, index) => {
    const schema = tool.input_schema ?? {};
    const props = (schema.properties ?? {}) as Record<string, unknown>;
    const required = (schema.required ?? []) as string[];
    const parameters = Object.entries(props).map(([name, info]) => {
      const paramInfo = info as Record<string, unknown>;
      const type = paramInfo.type ?? "any";
      const desc = paramInfo.description ?? "";
      const requiredFlag = required.includes(name);
      const enumValues = paramInfo.enum ? JSON.stringify(paramInfo.enum) : undefined;
      return [
        `    <parameter name="${name}">`,
        `      <type>${type}</type>`,
        `      <required>${requiredFlag}</required>`,
        desc ? `      <description>${escapeText(String(desc))}</description>` : "",
        enumValues ? `      <enum>${escapeText(enumValues)}</enum>` : "",
        "    </parameter>",
      ].filter(Boolean).join("\n");
    }).join("\n");

    const requiredXml = required.length
      ? required.map((r) => `    <param>${r}</param>`).join("\n")
      : "    <param>None</param>";

    return [
      `  <tool id="${index + 1}">`,
      `    <name>${tool.name}</name>`,
      `    <description>${escapeText(tool.description ?? "None")}</description>`,
      "    <required>",
      requiredXml,
      "    </required>",
      parameters ? `    <parameters>\n${parameters}\n    </parameters>` : "    <parameters>None</parameters>",
      "  </tool>",
    ].join("\n");
  }).join("\n");
  return `<function_list>\n${items}\n</function_list>`;
}

export interface PromptInjectionResult {
  messages: OpenAIChatMessage[];
  triggerSignal?: string;
}

export function injectPrompt(request: OpenAIChatRequest, tools: ClaudeToolDefinition[], triggerSignal?: string): PromptInjectionResult {
  if (!tools.length) {
    // 无工具时直接透传用户/系统消息，不注入任何工具指令
    return { messages: request.messages };
  }

  const signal = triggerSignal ?? randomTriggerSignal();
  const toolsXml = buildToolsXml(tools);
  const template = DEFAULT_TEMPLATE
    .replaceAll("{trigger_signal}", signal)
    .replace("{tools_list}", toolsXml);

  const messages: OpenAIChatMessage[] = [
    { role: "system", content: template },
    ...request.messages,
  ];

  return { messages, triggerSignal: signal };
}
