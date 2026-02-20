import { Action, ActionPanel, AI, Form, Icon, List, Toast, showToast, useNavigation } from "@raycast/api";
import http from "http";
import { useCallback, useEffect, useMemo, useState } from "react";
import { patchService, readServices, upsertService, writeServices } from "./storage";
import type { ManagedService } from "./types";

type ChatMessage = {
  role: string;
  content?: unknown;
};

type ChatCompletionsRequest = {
  model?: string;
  stream?: boolean;
  messages?: ChatMessage[];
};

type RunningServer = {
  serviceId: string;
  server: http.Server;
  modelValue: string;
};

const runningServers = new Map<number, RunningServer>();

function formatModelLabel(modelKey: string): string {
  return modelKey.replaceAll("_", " ");
}

function getServiceId(modelValue: string, port: number): string {
  return `${modelValue}:${port}`;
}

function dedupeServices(services: ManagedService[]): ManagedService[] {
  const byKey = new Map<string, ManagedService>();
  for (const service of services) {
    const key = getServiceId(service.modelValue, service.port);
    const prev = byKey.get(key);
    if (!prev || service.startedAt >= prev.startedAt) {
      byKey.set(key, { ...service, id: key });
    }
  }
  return Array.from(byKey.values()).sort((a, b) => b.startedAt - a.startedAt);
}

function getModelOptions() {
  const keys = Object.keys(AI.Model) as Array<keyof typeof AI.Model>;
  const uniqueByValue = new Map<string, { key: string; value: string }>();

  for (const key of keys) {
    const modelValue = AI.Model[key];
    if (!uniqueByValue.has(modelValue)) {
      uniqueByValue.set(modelValue, { key: String(key), value: modelValue });
    }
  }

  return Array.from(uniqueByValue.values()).sort((a, b) => a.key.localeCompare(b.key));
}

function isChatPath(pathname: string): boolean {
  return pathname === "/v1/chat/completions" || pathname === "/chat/completions";
}

function isModelsPath(pathname: string): boolean {
  return pathname === "/v1/models" || pathname === "/models";
}

function normalizeMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const textParts = content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item) {
          const text = (item as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }
        return "";
      })
      .filter(Boolean);
    return textParts.join("\n");
  }
  if (content && typeof content === "object" && "text" in content) {
    const text = (content as { text?: unknown }).text;
    if (typeof text === "string") return text;
  }
  return "";
}

function buildPrompt(messages: ChatMessage[]): string {
  const lines = messages
    .map((message) => {
      const role = message.role || "user";
      const text = normalizeMessageContent(message.content);
      return `${role}: ${text}`.trim();
    })
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
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
  };
}

function openAIStreamChunk(model: string, contentDelta: string) {
  return {
    id: `chatcmpl-raycast-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta: { content: contentDelta }, finish_reason: null }],
  };
}

function openAIStreamEnd(model: string) {
  return {
    id: `chatcmpl-raycast-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  };
}

function createServer(serviceId: string, modelKey: string, modelValue: string, port: number, onStopped: () => Promise<void>) {
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

        const requestModel = payload.model || modelValue;
        const prompt = buildPrompt(payload.messages);
        if (!prompt.trim()) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Could not parse messages content" }));
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

  server.on("close", async () => {
    runningServers.delete(port);
    await onStopped();
  });

  return server;
}

async function requestJSON(method: "GET" | "POST", port: number, path: string): Promise<{ statusCode: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: { "Content-Type": "application/json" },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => {
          raw += chunk.toString();
        });
        res.on("end", () => {
          const statusCode = res.statusCode || 500;
          try {
            resolve({ statusCode, body: raw ? JSON.parse(raw) : {} });
          } catch {
            resolve({ statusCode, body: { message: raw } });
          }
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function isServerHealthy(port: number): Promise<boolean> {
  try {
    const response = await requestJSON("GET", port, "/health");
    return response.statusCode >= 200 && response.statusCode < 300;
  } catch {
    return false;
  }
}

async function stopServer(port: number): Promise<string> {
  const inMemory = runningServers.get(port);
  if (inMemory) {
    await new Promise<void>((resolve, reject) => {
      inMemory.server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    return `Server on port ${port} is shutting down`;
  }

  const response = await requestJSON("POST", port, "/kill");
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(response.body.error || `Failed with status ${response.statusCode}`);
  }
  return response.body.message || "Server stopped";
}

function StartServiceForm(props: {
  onStart: (modelKey: string, modelValue: string, port: number) => Promise<void>;
}) {
  const { pop } = useNavigation();
  const modelOptions = useMemo(() => getModelOptions(), []);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const defaultModel = modelOptions.find((item) => item.key === "Perplexity_Sonar_Pro") || modelOptions[0];

  return (
    <Form
      navigationTitle="Start AI Server"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Start Service"
            onSubmit={async (values: { modelKey: string; port: string }) => {
              const port = Number(values.port.trim());
              if (!Number.isInteger(port) || port < 1 || port > 65535) {
                await showToast({ style: Toast.Style.Failure, title: "Invalid Port", message: "Port must be an integer between 1 and 65535" });
                return;
              }

              const selected = modelOptions.find((item) => item.key === values.modelKey);
              if (!selected) {
                await showToast({ style: Toast.Style.Failure, title: "Invalid Model" });
                return;
              }

              setIsSubmitting(true);
              try {
                await props.onStart(selected.key, selected.value, port);
                pop();
              } finally {
                setIsSubmitting(false);
              }
            }}
          />
        </ActionPanel>
      }
      isLoading={isSubmitting}
    >
      <Form.Dropdown id="modelKey" title="Model" defaultValue={defaultModel?.key}>
        {modelOptions.map((item) => (
          <Form.Dropdown.Item key={item.key} value={item.key} title={formatModelLabel(item.key)} keywords={[item.value]} />
        ))}
      </Form.Dropdown>
      <Form.TextField id="port" title="Port" defaultValue="1235" placeholder="1235" />
      <Form.Description text="启动后将暴露 /v1/chat/completions 和 /chat/completions。" />
    </Form>
  );
}

export default function Command() {
  const { push } = useNavigation();
  const [services, setServices] = useState<ManagedService[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    const existing = dedupeServices(await readServices());

    const next = await Promise.all(
      existing.map(async (service) => {
        const healthy = await isServerHealthy(service.port);
        if (healthy) return { ...service, status: "running" as const, lastError: undefined };
        if (service.status === "starting" || service.status === "running") return { ...service, status: "stopped" as const };
        return service;
      }),
    );

    const deduped = dedupeServices(next);
    await writeServices(deduped);
    setServices(deduped);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const startService = useCallback(
    async (modelKey: string, modelValue: string, port: number) => {
      const serviceId = getServiceId(modelValue, port);
      const isRunningOnPort = await isServerHealthy(port);
      const existing = dedupeServices(await readServices());
      const existingSame = existing.find((s) => s.id === serviceId);

      if (isRunningOnPort && existingSame?.status === "running") {
        await showToast({ style: Toast.Style.Failure, title: "Already Running", message: `${modelKey} on :${port}` });
        return;
      }

      if (isRunningOnPort && !runningServers.has(port)) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Port Already In Use",
          message: `Another process is using port ${port}`,
        });
        return;
      }

      const record: ManagedService = {
        id: serviceId,
        modelKey,
        modelValue,
        port,
        status: "starting",
        startedAt: Date.now(),
      };
      await upsertService(record);

      const server = createServer(serviceId, modelKey, modelValue, port, async () => {
        await patchService(serviceId, { status: "stopped" });
      });

      try {
        await new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(port, () => resolve());
        });

        runningServers.set(port, { serviceId, server, modelValue });
        await patchService(serviceId, { status: "running", startedAt: Date.now(), lastError: undefined });
        await showToast({ style: Toast.Style.Success, title: "Service Started", message: `${modelKey} on :${port}` });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await patchService(serviceId, { status: "error", lastError: message });
        await showToast({ style: Toast.Style.Failure, title: "Launch Failed", message });
      }

      await refresh();
    },
    [refresh],
  );

  const runningCount = services.filter((item) => item.status === "running").length;

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search services..." navigationTitle="Raycast AI Server">
      <List.Section title="Actions">
        <List.Item
          title="Start New Service"
          icon={Icon.Play}
          accessories={[{ text: `${runningCount} running` }]}
          actions={
            <ActionPanel>
              <Action title="Start Service" icon={Icon.Play} onAction={() => push(<StartServiceForm onStart={startService} />)} />
              <Action title="Refresh" icon={Icon.ArrowClockwise} onAction={refresh} />
            </ActionPanel>
          }
        />
      </List.Section>

      <List.Section title="Services" subtitle={services.length > 0 ? String(services.length) : undefined}>
        {services.length === 0 ? (
          <List.Item
            title="No Service Yet"
            subtitle="Start your first local OpenAI-compatible server"
            icon={Icon.Dot}
            actions={
              <ActionPanel>
                <Action title="Start Service" onAction={() => push(<StartServiceForm onStart={startService} />)} />
              </ActionPanel>
            }
          />
        ) : null}

        {services.map((service) => (
          <List.Item
            key={service.id}
            title={`${formatModelLabel(service.modelKey)}  :${service.port}`}
            subtitle={service.modelValue}
            icon={
              service.status === "running"
                ? Icon.CheckCircle
                : service.status === "starting"
                  ? Icon.Clock
                  : service.status === "error"
                    ? Icon.ExclamationMark
                    : Icon.Stop
            }
            accessories={[
              { text: service.status },
              ...(service.lastError ? [{ tag: { value: "error" as const, color: "#E74C3C" } }] : []),
              { date: new Date(service.startedAt), tooltip: "Updated At" },
            ]}
            actions={
              <ActionPanel>
                {service.status === "running" || service.status === "starting" ? (
                  <Action
                    title="Stop Service"
                    icon={Icon.Stop}
                    onAction={async () => {
                      try {
                        const message = await stopServer(service.port);
                        await patchService(service.id, { status: "stopped", lastError: undefined });
                        await showToast({ style: Toast.Style.Success, title: "Service Stopped", message });
                      } catch (error) {
                        const message = error instanceof Error ? error.message : String(error);
                        await patchService(service.id, { status: "error", lastError: message });
                        await showToast({ style: Toast.Style.Failure, title: "Stop Failed", message });
                      }
                      await refresh();
                    }}
                  />
                ) : (
                  <Action
                    title="Start Service"
                    icon={Icon.Play}
                    onAction={() => startService(service.modelKey, service.modelValue, service.port)}
                  />
                )}

                <Action
                  title="Refresh"
                  icon={Icon.ArrowClockwise}
                  onAction={refresh}
                />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
    </List>
  );
}
