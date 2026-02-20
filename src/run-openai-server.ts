import { AI, Toast, showToast } from "@raycast/api";
import http from "http";
import { patchService } from "./storage";
import type { ServerLaunchContext } from "./types";

type ChatMessage = {
  role: string;
  content?: unknown;
};

type ChatCompletionsRequest = {
  model?: string;
  stream?: boolean;
  messages?: ChatMessage[];
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

function isChatPath(pathname: string): boolean {
  return pathname === "/v1/chat/completions" || pathname === "/chat/completions";
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

function buildPrompt(messages: ChatMessage[]): string {
  const lines = messages
    .map((message) => `${message.role || "user"}: ${normalizeMessageContent(message.content)}`.trim())
    .filter(Boolean);

  if (lines.length === 0) return "";
  return `${lines.join("\n\n")}\n\nassistant:`;
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

async function startService(context: ServerLaunchContext): Promise<{ ok: boolean; error?: string }> {
  const { serviceId, modelKey, modelValue, port } = context;
  const existing = runtimes.get(port);
  if (existing) {
    if (existing.serviceId === serviceId) {
      return { ok: true };
    }
    return { ok: false, error: `Port ${port} already used by another managed service` };
  }

  const selectedModel = (AI.Model[modelKey as keyof typeof AI.Model] || modelValue) as AI.Model;

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
      res.end(JSON.stringify({ message: `Server on port ${port} is shutting down` }));
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

        const prompt = buildPrompt(payload.messages);
        if (!prompt.trim()) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Could not parse messages content" }));
          return;
        }

        const requestModel = payload.model || modelValue;
        const stream = AI.ask(prompt, { model: selectedModel });

        if (payload.stream) {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });

          stream.on("data", (chunk) => {
            res.write(`data: ${JSON.stringify(openAIStreamChunk(requestModel, chunk.toString()))}\n\n`);
          });

          await stream;
          res.write(`data: ${JSON.stringify(openAIStreamEnd(requestModel))}\n\n`);
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
    await patchService(serviceId, { status: "error", lastError: error.message });
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
    await patchService(serviceId, { status: "running", lastError: undefined, startedAt: Date.now() });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await patchService(serviceId, { status: "error", lastError: message });
    return { ok: false, error: message };
  }
}

async function stopService(port: number): Promise<{ ok: boolean; error?: string }> {
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
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
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
        if (!payload.serviceId || !payload.modelKey || !payload.modelValue || !payload.port) {
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
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
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
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
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
    await showToast({ style: Toast.Style.Failure, title: "Daemon start failed", message });
    return;
  }

  await new Promise<void>((resolve) => {
    admin.on("close", () => resolve());
  });
}
