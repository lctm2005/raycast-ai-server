import { AI, Toast, showToast } from "@raycast/api";
import http from "http";
import { patchService } from "./storage";
import type { ServerLaunchContext } from "./types";

type ChatMessage = {
  role: string;
  content?: unknown;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ChatToolCall[];
};

type ChatToolDefinition = {
  type?: "function";
  function?: {
    name?: string;
    description?: string;
    parameters?: unknown;
  };
};

type ChatToolChoice =
  | "none"
  | "auto"
  | "required"
  | {
      type?: "function";
      function?: {
        name?: string;
      };
    };

type ChatToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

type ChatCompletionsRequest = {
  model?: string;
  stream?: boolean;
  messages?: ChatMessage[];
  tools?: ChatToolDefinition[];
  tool_choice?: ChatToolChoice;
};

type ManagedRuntime = {
  serviceId: string;
  modelKey: string;
  modelValue: string;
  port: number;
  server: http.Server;
};

const ADMIN_PORT = 46321;
const runtimes = new Map<number, ManagedRuntime>();
const TOOL_CALL_PREFIX = "__TOOL_CALL__";
const FINAL_PREFIX = "__FINAL__";
const MAX_TOOL_PROTOCOL_ATTEMPTS = 3;

function isChatPath(pathname: string): boolean {
  return (
    pathname === "/v1/chat/completions" || pathname === "/chat/completions"
  );
}

function isModelsPath(pathname: string): boolean {
  return pathname === "/v1/models" || pathname === "/models";
}

function normalizeMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item) {
          const text = (item as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (content && typeof content === "object" && "text" in content) {
    const text = (content as { text?: unknown }).text;
    if (typeof text === "string") return text;
  }
  return "";
}

function normalizeToolChoiceName(
  toolChoice: ChatToolChoice | undefined,
): string | undefined {
  if (!toolChoice || typeof toolChoice === "string") return undefined;
  return toolChoice.function?.name?.trim();
}

function normalizeTools(
  tools: ChatToolDefinition[] | undefined,
): ChatToolDefinition[] {
  if (!Array.isArray(tools)) return [];
  return tools
    .filter(
      (tool) =>
        tool?.type === "function" &&
        typeof tool.function?.name === "string" &&
        tool.function.name.trim().length > 0,
    )
    .map((tool) => ({
      type: "function",
      function: {
        name: tool.function?.name?.trim(),
        description:
          typeof tool.function?.description === "string"
            ? tool.function.description.trim()
            : undefined,
        parameters: tool.function?.parameters ?? {},
      },
    }));
}

function serializeAssistantToolCalls(message: ChatMessage): string {
  if (!Array.isArray(message.tool_calls) || message.tool_calls.length === 0)
    return "";
  const calls = message.tool_calls
    .map((call) => {
      const name = call?.function?.name || "unknown_tool";
      const args = call?.function?.arguments || "{}";
      return `${name}(${args})`;
    })
    .join("; ");
  return calls ? `assistant_tool_calls: ${calls}` : "";
}

function buildPrompt(
  messages: ChatMessage[],
  tools: ChatToolDefinition[],
  toolChoice: ChatToolChoice | undefined,
): string {
  const shouldUseTools = tools.length > 0 && toolChoice !== "none";
  const forcedToolName = normalizeToolChoiceName(toolChoice);

  const lines = messages
    .map((message) => {
      const role = message.role || "user";
      if (role === "tool") {
        const toolName = message.name || message.tool_call_id || "tool";
        return `tool(${toolName}): ${normalizeMessageContent(message.content)}`.trim();
      }

      if (role === "assistant") {
        const text = normalizeMessageContent(message.content);
        const calls = serializeAssistantToolCalls(message);
        return [text ? `assistant: ${text}` : "", calls]
          .filter(Boolean)
          .join("\n");
      }

      return `${role}: ${normalizeMessageContent(message.content)}`.trim();
    })
    .filter(Boolean);

  if (!shouldUseTools) {
    if (lines.length === 0) return "";
    return `${lines.join("\n\n")}\n\nassistant:`;
  }

  let forcedNote = "";
  if (forcedToolName) {
    forcedNote = `You MUST call tool "${forcedToolName}" in this turn.`;
  } else if (toolChoice === "required") {
    forcedNote = "You MUST call exactly one tool in this turn.";
  }

  const toolList = tools
    .map((tool) =>
      JSON.stringify({
        name: tool.function?.name,
        description: tool.function?.description,
        parameters: tool.function?.parameters ?? {},
      }),
    )
    .join("\n");

  const conversation = lines.length > 0 ? lines.join("\n\n") : "user: (empty)";
  return [
    "<instructions>",
    "You are a function-calling assistant. You MUST respond in EXACTLY one of two formats below. No other output is allowed.",
    "",
    `Format A — call a tool: ${TOOL_CALL_PREFIX}{"name":"TOOL_NAME","arguments":{...}}`,
    `Format B — plain text reply (ONLY if no tool is relevant): ${FINAL_PREFIX}your reply here`,
    "",
    "CRITICAL RULES:",
    "1. Your entire response is exactly ONE line starting with either " + TOOL_CALL_PREFIX + " or " + FINAL_PREFIX + ".",
    "2. If the user's request matches any available tool, you MUST use Format A to call it.",
    "3. Never refuse or explain — just call the tool.",
    "4. No markdown, no code fences, no extra text.",
    forcedNote,
    "</instructions>",
    "",
    "<tools>",
    toolList,
    "</tools>",
    "",
    "<conversation>",
    conversation,
    "</conversation>",
    "",
    "assistant:",
  ].filter(Boolean).join("\n");
}

function parseJsonLoose(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return JSON.parse(trimmed);
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    return JSON.parse(fenced[1]);
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1));
  }

  return undefined;
}

function toToolArgumentString(value: unknown): string {
  if (typeof value === "string") {
    try {
      JSON.parse(value);
      return value;
    } catch {
      return JSON.stringify({ value });
    }
  }

  if (value === undefined) return "{}";
  try {
    return JSON.stringify(value);
  } catch {
    return "{}";
  }
}

function parseFinalContentFromAnswer(answer: string): string {
  const trimmed = answer.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith(FINAL_PREFIX)) {
    return trimmed.slice(FINAL_PREFIX.length).trim();
  }

  try {
    const parsed = parseJsonLoose(answer);
    if (!parsed || typeof parsed !== "object") return answer;
    const data = parsed as Record<string, unknown>;
    if (data.type === "final" && typeof data.content === "string") {
      return data.content;
    }
    return answer;
  } catch {
    return answer;
  }
}

function parseToolArguments(value: unknown): {
  ok: boolean;
  parsed: unknown;
  error?: string;
} {
  if (typeof value !== "string") {
    return { ok: true, parsed: value };
  }

  try {
    return { ok: true, parsed: JSON.parse(value) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      parsed: undefined,
      error: `arguments is not valid JSON: ${message}`,
    };
  }
}

function validateJsonValueType(value: unknown, expectedType: string): boolean {
  switch (expectedType) {
    case "object":
      return (
        typeof value === "object" && value !== null && !Array.isArray(value)
      );
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      return true;
  }
}

function validateAgainstSchema(
  value: unknown,
  schema: unknown,
  path = "$",
): string[] {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return [];
  const rule = schema as Record<string, unknown>;
  const errors: string[] = [];

  const typeRule = rule.type;
  if (typeof typeRule === "string") {
    if (!validateJsonValueType(value, typeRule)) {
      errors.push(`${path} should be ${typeRule}`);
      return errors;
    }
  } else if (Array.isArray(typeRule) && typeRule.length > 0) {
    const allowed = typeRule.filter((t): t is string => typeof t === "string");
    if (
      allowed.length > 0 &&
      !allowed.some((t) => validateJsonValueType(value, t))
    ) {
      errors.push(`${path} should be one of [${allowed.join(", ")}]`);
      return errors;
    }
  }

  if (Array.isArray(rule.enum) && rule.enum.length > 0) {
    if (
      !rule.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))
    ) {
      errors.push(`${path} should match enum values`);
      return errors;
    }
  }

  if ("const" in rule && JSON.stringify(rule.const) !== JSON.stringify(value)) {
    errors.push(`${path} should equal const value`);
    return errors;
  }

  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const props = rule.properties;
    const required = Array.isArray(rule.required)
      ? rule.required.filter((item): item is string => typeof item === "string")
      : [];
    for (const key of required) {
      if (!(key in obj)) errors.push(`${path}.${key} is required`);
    }

    if (props && typeof props === "object" && !Array.isArray(props)) {
      for (const [key, childSchema] of Object.entries(props)) {
        if (!(key in obj)) continue;
        errors.push(
          ...validateAgainstSchema(obj[key], childSchema, `${path}.${key}`),
        );
      }
    }

    if (
      rule.additionalProperties === false &&
      props &&
      typeof props === "object" &&
      !Array.isArray(props)
    ) {
      const allowedKeys = new Set(
        Object.keys(props as Record<string, unknown>),
      );
      for (const key of Object.keys(obj)) {
        if (!allowedKeys.has(key)) errors.push(`${path}.${key} is not allowed`);
      }
    }
  }

  if (Array.isArray(value) && rule.items) {
    for (let i = 0; i < value.length; i += 1) {
      errors.push(
        ...validateAgainstSchema(value[i], rule.items, `${path}[${i}]`),
      );
    }
  }

  return errors;
}

function normalizeToolCallFromInput(
  rawCall: Record<string, unknown>,
  tools: ChatToolDefinition[],
  toolChoice: ChatToolChoice | undefined,
): { call?: ChatToolCall; issues: string[] } {
  const issues: string[] = [];
  const fn =
    rawCall.function && typeof rawCall.function === "object"
      ? (rawCall.function as Record<string, unknown>)
      : undefined;
  const nameSource = rawCall.name ?? fn?.name;
  const argumentsSource = rawCall.arguments ?? fn?.arguments;

  if (typeof nameSource !== "string" || !nameSource.trim()) {
    issues.push("tool call name is missing");
    return { issues };
  }

  const name = nameSource.trim();
  const forcedToolName = normalizeToolChoiceName(toolChoice);
  const toolMap = new Map(
    tools
      .map((tool) => {
        const toolName = tool.function?.name;
        if (!toolName) return undefined;
        return [toolName, tool] as const;
      })
      .filter((item): item is readonly [string, ChatToolDefinition] =>
        Boolean(item),
      ),
  );

  if (!toolMap.has(name)) {
    issues.push(`tool "${name}" is not in the declared tools`);
    return { issues };
  }
  if (forcedToolName && forcedToolName !== name) {
    issues.push(
      `tool "${name}" does not satisfy forced tool_choice "${forcedToolName}"`,
    );
    return { issues };
  }

  const parsedArgs = parseToolArguments(argumentsSource ?? {});
  if (!parsedArgs.ok) {
    issues.push(parsedArgs.error || "invalid arguments");
    return { issues };
  }

  const toolSchema = toolMap.get(name)?.function?.parameters;
  const schemaErrors = validateAgainstSchema(parsedArgs.parsed, toolSchema);
  if (schemaErrors.length > 0) {
    issues.push(...schemaErrors.slice(0, 5));
    return { issues };
  }

  return {
    call: {
      id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: "function",
      function: {
        name,
        arguments: toToolArgumentString(parsedArgs.parsed),
      },
    },
    issues,
  };
}

function parseToolCallsFromAnswer(
  answer: string,
  tools: ChatToolDefinition[],
  toolChoice: ChatToolChoice | undefined,
): { toolCalls: ChatToolCall[]; finalContent?: string; issues: string[] } {
  if (tools.length === 0 || toolChoice === "none") {
    return {
      toolCalls: [],
      finalContent: parseFinalContentFromAnswer(answer),
      issues: [],
    };
  }

  const issues: string[] = [];
  const trimmed = answer.trim();
  if (!trimmed) {
    return { toolCalls: [], issues: ["empty response"] };
  }

  if (trimmed.startsWith(FINAL_PREFIX)) {
    return {
      toolCalls: [],
      finalContent: trimmed.slice(FINAL_PREFIX.length).trim(),
      issues,
    };
  }

  if (trimmed.startsWith(TOOL_CALL_PREFIX)) {
    try {
      const payload = JSON.parse(
        trimmed.slice(TOOL_CALL_PREFIX.length).trim(),
      ) as Record<string, unknown>;
      const parsed = normalizeToolCallFromInput(payload, tools, toolChoice);
      if (parsed.call) return { toolCalls: [parsed.call], issues };
      return { toolCalls: [], issues: parsed.issues };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        toolCalls: [],
        issues: [`invalid ${TOOL_CALL_PREFIX} payload: ${message}`],
      };
    }
  }

  let parsed: unknown;
  try {
    parsed = parseJsonLoose(answer);
  } catch {
    return {
      toolCalls: [],
      issues: ["response is not parseable JSON or protocol envelope"],
    };
  }

  if (!parsed || typeof parsed !== "object") {
    return { toolCalls: [], issues: ["response is not an object"] };
  }

  const data = parsed as Record<string, unknown>;
  const calls: ChatToolCall[] = [];
  if (Array.isArray(data.tool_calls)) {
    for (const item of data.tool_calls) {
      if (!item || typeof item !== "object") continue;
      const raw = item as Record<string, unknown>;
      const parsedCall = normalizeToolCallFromInput(raw, tools, toolChoice);
      if (parsedCall.call) calls.push(parsedCall.call);
      else issues.push(...parsedCall.issues);
    }
  }

  if (
    calls.length === 0 &&
    data.tool_call &&
    typeof data.tool_call === "object"
  ) {
    const raw = data.tool_call as Record<string, unknown>;
    const parsedCall = normalizeToolCallFromInput(raw, tools, toolChoice);
    if (parsedCall.call) calls.push(parsedCall.call);
    else issues.push(...parsedCall.issues);
  }

  if (calls.length === 0) {
    const parsedCall = normalizeToolCallFromInput(data, tools, toolChoice);
    if (parsedCall.call) calls.push(parsedCall.call);
    else issues.push(...parsedCall.issues);
  }

  if (calls.length > 0) {
    return { toolCalls: calls, issues };
  }

  if (typeof data.content === "string") {
    return { toolCalls: [], finalContent: data.content, issues };
  }

  return {
    toolCalls: [],
    issues: issues.length > 0 ? issues : ["no valid tool call found"],
  };
}

async function resolveToolProtocolResult(
  basePrompt: string,
  selectedModel: AI.Model,
  tools: ChatToolDefinition[],
  toolChoice: ChatToolChoice | undefined,
): Promise<{ toolCalls?: ChatToolCall[]; content?: string; error?: string }> {
  const mustReturnToolCall =
    toolChoice === "required" ||
    Boolean(normalizeToolChoiceName(toolChoice)) ||
    (toolChoice === "auto" && tools.length === 1);
  let prompt = basePrompt;
  let lastIssues: string[] = [];

  for (let attempt = 1; attempt <= MAX_TOOL_PROTOCOL_ATTEMPTS; attempt += 1) {
    const answer = await AI.ask(prompt, { model: selectedModel, creativity: "none" });
    const parsed = parseToolCallsFromAnswer(answer, tools, toolChoice);

    if (parsed.toolCalls.length > 0) {
      return { toolCalls: parsed.toolCalls };
    }

    if (!mustReturnToolCall) {
      return {
        content: parsed.finalContent ?? parseFinalContentFromAnswer(answer),
      };
    }

    lastIssues =
      parsed.issues.length > 0
        ? parsed.issues
        : ["no valid tool call returned"];
    if (attempt < MAX_TOOL_PROTOCOL_ATTEMPTS) {
      prompt = `${basePrompt}\n\nYour previous output was invalid.\nProblems:\n- ${lastIssues.slice(0, 5).join("\n- ")}\n\nRetry now and return exactly one line in the required format.`;
    }
  }

  return {
    error: `model failed to produce a valid tool call after ${MAX_TOOL_PROTOCOL_ATTEMPTS} attempts: ${lastIssues.join("; ")}`,
  };
}

function openAIResponse(model: string, content: string) {
  return {
    id: `chatcmpl-raycast-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
  };
}

function openAIToolResponse(model: string, toolCalls: ChatToolCall[]) {
  return {
    id: `chatcmpl-raycast-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: toolCalls,
        },
        finish_reason: "tool_calls",
      },
    ],
  };
}

function openAIStreamChunk(model: string, contentDelta: string) {
  return {
    id: `chatcmpl-raycast-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: { content: contentDelta },
        finish_reason: null,
      },
    ],
  };
}

function openAIStreamToolChunk(model: string, toolCalls: ChatToolCall[]) {
  return {
    id: `chatcmpl-raycast-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: toolCalls.map((toolCall, index) => ({
            index,
            id: toolCall.id,
            type: "function",
            function: {
              name: toolCall.function.name,
              arguments: toolCall.function.arguments,
            },
          })),
        },
        finish_reason: null,
      },
    ],
  };
}

function openAIStreamEnd(model: string) {
  return {
    id: `chatcmpl-raycast-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: "stop",
      },
    ],
  };
}

function openAIStreamToolEnd(model: string) {
  return {
    id: `chatcmpl-raycast-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: "tool_calls",
      },
    ],
  };
}

async function startService(
  context: ServerLaunchContext,
): Promise<{ ok: boolean; error?: string }> {
  const { serviceId, modelKey, modelValue, port } = context;
  const existing = runtimes.get(port);
  if (existing) {
    if (existing.serviceId === serviceId) {
      return { ok: true };
    }
    return {
      ok: false,
      error: `Port ${port} already used by another managed service`,
    };
  }

  const selectedModel = (AI.Model[modelKey as keyof typeof AI.Model] ||
    modelValue) as AI.Model;

  const server = http.createServer((req, res) => {
    const method = req.method || "GET";
    const pathname = req.url?.split("?")[0] || "/";

    if (method === "GET" && pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, model: modelValue, port, serviceId }));
      return;
    }

    if (method === "POST" && pathname === "/kill") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ message: `Server on port ${port} is shutting down` }),
      );
      server.close();
      return;
    }

    if (method === "GET" && isModelsPath(pathname)) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          object: "list",
          data: [{ id: modelValue, object: "model", owned_by: "raycast" }],
        }),
      );
      return;
    }

    if (method !== "POST" || !isChatPath(pathname)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Endpoint not found" }));
      return;
    }

    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", async () => {
      try {
        const payload = JSON.parse(body || "{}") as ChatCompletionsRequest;
        if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "messages is required" }));
          return;
        }

        const tools = normalizeTools(payload.tools);
        const toolChoice = payload.tool_choice;
        const prompt = buildPrompt(payload.messages, tools, toolChoice);
        if (!prompt.trim()) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ error: "Could not parse messages content" }),
          );
          return;
        }

        const requestModel = payload.model || modelValue;
        const shouldUseToolProtocol = tools.length > 0 && toolChoice !== "none";

        if (shouldUseToolProtocol) {
          const resolved = await resolveToolProtocolResult(
            prompt,
            selectedModel,
            tools,
            toolChoice,
          );
          if (resolved.error) {
            res.writeHead(422, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: resolved.error }));
            return;
          }

          if (payload.stream) {
            if (resolved.toolCalls && resolved.toolCalls.length > 0) {
              res.writeHead(200, {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                Connection: "keep-alive",
              });
              res.write(
                `data: ${JSON.stringify(openAIStreamToolChunk(requestModel, resolved.toolCalls))}\n\n`,
              );
              res.write(
                `data: ${JSON.stringify(openAIStreamToolEnd(requestModel))}\n\n`,
              );
              res.write("data: [DONE]\n\n");
              res.end();
              return;
            }

            const content = resolved.content ?? "";
            res.writeHead(200, {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            });
            res.write(
              `data: ${JSON.stringify(openAIStreamChunk(requestModel, content))}\n\n`,
            );
            res.write(
              `data: ${JSON.stringify(openAIStreamEnd(requestModel))}\n\n`,
            );
            res.write("data: [DONE]\n\n");
            res.end();
            return;
          }

          if (resolved.toolCalls && resolved.toolCalls.length > 0) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify(
                openAIToolResponse(requestModel, resolved.toolCalls),
              ),
            );
            return;
          }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify(
              openAIResponse(requestModel, resolved.content ?? ""),
            ),
          );
          return;
        }

        const stream = AI.ask(prompt, { model: selectedModel });

        if (payload.stream) {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });

          stream.on("data", (chunk) => {
            res.write(
              `data: ${JSON.stringify(openAIStreamChunk(requestModel, chunk.toString()))}\n\n`,
            );
          });

          await stream;
          res.write(
            `data: ${JSON.stringify(openAIStreamEnd(requestModel))}\n\n`,
          );
          res.write("data: [DONE]\n\n");
          res.end();
          return;
        }

        const answer = await stream;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(openAIResponse(requestModel, answer)));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: message }));
      }
    });
  });

  server.on("error", async (error: Error) => {
    await patchService(serviceId, {
      status: "error",
      lastError: error.message,
    });
  });

  server.on("close", async () => {
    runtimes.delete(port);
    await patchService(serviceId, { status: "stopped" });
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, () => resolve());
    });
    runtimes.set(port, { serviceId, modelKey, modelValue, port, server });
    await patchService(serviceId, {
      status: "running",
      lastError: undefined,
      startedAt: Date.now(),
    });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await patchService(serviceId, { status: "error", lastError: message });
    return { ok: false, error: message };
  }
}

async function stopService(
  port: number,
): Promise<{ ok: boolean; error?: string }> {
  const runtime = runtimes.get(port);
  if (!runtime) {
    return { ok: true };
  }
  try {
    await new Promise<void>((resolve, reject) => {
      runtime.server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => resolve(body));
  });
}

export default async function Command() {
  const admin = http.createServer(async (req, res) => {
    const method = req.method || "GET";
    const pathname = req.url?.split("?")[0] || "/";

    if (method === "GET" && pathname === "/admin/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, count: runtimes.size }));
      return;
    }

    if (method === "GET" && pathname === "/admin/services") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          services: Array.from(runtimes.values()).map((r) => ({
            serviceId: r.serviceId,
            modelKey: r.modelKey,
            modelValue: r.modelValue,
            port: r.port,
          })),
        }),
      );
      return;
    }

    if (method === "POST" && pathname === "/admin/start") {
      const body = await readBody(req);
      try {
        const payload = JSON.parse(body || "{}") as ServerLaunchContext;
        if (
          !payload.serviceId ||
          !payload.modelKey ||
          !payload.modelValue ||
          !payload.port
        ) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "invalid payload" }));
          return;
        }

        const result = await startService(payload);
        if (!result.ok) {
          res.writeHead(409, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: result.error || "start failed" }));
          return;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
      return;
    }

    if (method === "POST" && pathname === "/admin/stop") {
      const body = await readBody(req);
      try {
        const payload = JSON.parse(body || "{}") as { port?: number };
        if (!payload.port) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "port is required" }));
          return;
        }

        const result = await stopService(payload.port);
        if (!result.ok) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: result.error || "stop failed" }));
          return;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "admin endpoint not found" }));
  });

  try {
    await new Promise<void>((resolve, reject) => {
      admin.once("error", reject);
      admin.listen(ADMIN_PORT, "127.0.0.1", () => resolve());
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await showToast({
      style: Toast.Style.Failure,
      title: "Daemon start failed",
      message,
    });
    return;
  }

  await new Promise<void>((resolve) => {
    admin.on("close", () => resolve());
  });
}
