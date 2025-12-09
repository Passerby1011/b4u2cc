import { ToolifyParser } from "./parser.ts";

function feed(parser: ToolifyParser, text: string) {
  for (const char of text) {
    parser.feedChar(char);
  }
}

Deno.test("ToolifyParser emits text and tool_call events", () => {
  const parser = new ToolifyParser("<<CALL_aa11>>");
  const input =
    `Thoughts...<<CALL_aa11>>\n<invoke name="get_weather">\n<parameter name="city">"New York"</parameter>\n<parameter name="unit">"c"</parameter>\n</invoke>\n`;
  feed(parser, input);
  parser.finish();
  const events = parser.consumeEvents();

  const textEvent = events.find((e) => e.type === "text");
  if (!textEvent || textEvent.type !== "text") {
    throw new Error("Expected text event");
  }
  if (!textEvent.content.includes("Thoughts")) {
    throw new Error("Text event missing content");
  }

  const toolEvent = events.find((e) => e.type === "tool_call");
  if (!toolEvent || toolEvent.type !== "tool_call") {
    throw new Error("Expected tool call event");
  }
  if (toolEvent.call.name !== "get_weather") {
    throw new Error("Tool call name mismatch");
  }
  if (toolEvent.call.arguments.city !== "New York") {
    throw new Error("Tool arguments not parsed");
  }
});

Deno.test("ToolifyParser parses thinking blocks when no triggerSignal", () => {
  const parser = new ToolifyParser(); // 无 triggerSignal：仅解析 thinking，不解析工具
  const input = "Intro text<thinking> internal chain-of-thought </thinking>Outro";
  feed(parser, input);
  parser.finish();
  const events = parser.consumeEvents();

  const textEvents = events.filter((e) => e.type === "text") as { type: "text"; content: string }[];
  const thinkingEvents = events.filter((e) => e.type === "thinking") as { type: "thinking"; content: string }[];

  if (!textEvents.length) {
    throw new Error("Expected at least one text event");
  }
  const combinedText = textEvents.map((e) => e.content).join("");
  if (!combinedText.includes("Intro text") || !combinedText.includes("Outro")) {
    throw new Error(`Text events missing expected content: ${combinedText}`);
  }

  if (thinkingEvents.length !== 1) {
    throw new Error(`Expected exactly one thinking event, got ${thinkingEvents.length}`);
  }
  const thinking = thinkingEvents[0].content;
  if (!thinking.includes("internal chain-of-thought")) {
    throw new Error(`Thinking content not parsed correctly: ${thinking}`);
  }
});
