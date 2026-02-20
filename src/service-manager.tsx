import {
  Action,
  ActionPanel,
  AI,
  Form,
  Icon,
  LaunchType,
  List,
  Toast,
  launchCommand,
  showToast,
  useNavigation,
} from "@raycast/api";
import http from "http";
import { useCallback, useEffect, useMemo, useState } from "react";
import { patchService, readServices, upsertService, writeServices } from "./storage";
import type { ManagedService, ServerLaunchContext } from "./types";

const ADMIN_PORT = 46321;

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

async function requestJSON(
  method: "GET" | "POST",
  port: number,
  path: string,
  payload?: unknown,
): Promise<{ statusCode: number; body: any }> {
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
            const body = raw ? JSON.parse(raw) : {};
            resolve({ statusCode, body });
          } catch {
            resolve({ statusCode, body: { message: raw } });
          }
        });
      },
    );
    req.on("error", reject);
    if (payload !== undefined) {
      req.write(JSON.stringify(payload));
    }
    req.end();
  });
}

async function getHealth(port: number): Promise<{ ok: boolean; serviceId?: string }> {
  try {
    const response = await requestJSON("GET", port, "/health");
    if (response.statusCode < 200 || response.statusCode >= 300) return { ok: false };
    return {
      ok: true,
      serviceId:
        typeof response.body?.serviceId === "string"
          ? (response.body.serviceId as string)
          : undefined,
    };
  } catch {
    return { ok: false };
  }
}

async function ensureDaemon(): Promise<void> {
  try {
    const ok = await requestJSON("GET", ADMIN_PORT, "/admin/health");
    if (ok.statusCode >= 200 && ok.statusCode < 300) return;
  } catch {
    // daemon not up
  }

  await launchCommand({ name: "run-openai-server", type: LaunchType.UserInitiated });

  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 150));
    try {
      const res = await requestJSON("GET", ADMIN_PORT, "/admin/health");
      if (res.statusCode >= 200 && res.statusCode < 300) return;
    } catch {
      // retry
    }
  }

  throw new Error("Daemon did not become ready");
}

async function daemonStart(context: ServerLaunchContext): Promise<void> {
  await ensureDaemon();
  const response = await requestJSON("POST", ADMIN_PORT, "/admin/start", context);
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(response.body.error || "Failed to start service in daemon");
  }
}

async function daemonStop(port: number): Promise<void> {
  await ensureDaemon();
  const response = await requestJSON("POST", ADMIN_PORT, "/admin/stop", { port });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(response.body.error || "Failed to stop service in daemon");
  }
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
                await showToast({
                  style: Toast.Style.Failure,
                  title: "Invalid Port",
                  message: "Port must be an integer between 1 and 65535",
                });
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
      <Form.Description text="启动后将暴露 /v1/chat/completions 以及 /chat/completions。" />
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
        const health = await getHealth(service.port);
        if (health.ok) {
          const id = health.serviceId && health.serviceId.includes(":") ? health.serviceId : service.id;
          return { ...service, id, status: "running" as const, lastError: undefined };
        }
        if (service.status === "starting" || service.status === "running") {
          return { ...service, status: "stopped" as const };
        }
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
      const health = await getHealth(port);

      if (health.ok && health.serviceId === serviceId) {
        await showToast({ style: Toast.Style.Failure, title: "Already Running", message: `${modelKey} on :${port}` });
        return;
      }

      if (health.ok && health.serviceId !== serviceId) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Port Already In Use",
          message: `Port ${port} is occupied by another service`,
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

      try {
        await daemonStart({ serviceId, modelKey, modelValue, port });
        await patchService(serviceId, { status: "running", lastError: undefined, startedAt: Date.now() });
        await showToast({ style: Toast.Style.Success, title: "Server Launching", message: `${modelKey} on :${port}` });
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
                        await daemonStop(service.port);
                        await patchService(service.id, { status: "stopped", lastError: undefined });
                        await showToast({ style: Toast.Style.Success, title: "Service Stopped" });
                      } catch (error) {
                        const message = error instanceof Error ? error.message : String(error);
                        await patchService(service.id, { status: "error", lastError: message });
                        await showToast({ style: Toast.Style.Failure, title: "Stop Failed", message });
                      }
                      await refresh();
                    }}
                  />
                ) : (
                  <Action title="Start Service" icon={Icon.Play} onAction={() => startService(service.modelKey, service.modelValue, service.port)} />
                )}

                <Action title="Refresh" icon={Icon.ArrowClockwise} onAction={refresh} />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
    </List>
  );
}
