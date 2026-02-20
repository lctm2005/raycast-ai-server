"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/service-manager.tsx
var service_manager_exports = {};
__export(service_manager_exports, {
  default: () => Command
});
module.exports = __toCommonJS(service_manager_exports);
var import_api2 = require("@raycast/api");
var import_http = __toESM(require("http"));
var import_react = require("react");

// src/storage.ts
var import_api = require("@raycast/api");
var SERVICES_KEY = "raycast-ai-server-services";
async function readServices() {
  const raw = await import_api.LocalStorage.getItem(SERVICES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
async function writeServices(services) {
  await import_api.LocalStorage.setItem(SERVICES_KEY, JSON.stringify(services));
}
async function upsertService(next) {
  const current = await readServices();
  const idx = current.findIndex((service) => service.id === next.id);
  if (idx === -1) {
    current.push(next);
  } else {
    current[idx] = next;
  }
  await writeServices(current);
}
async function patchService(id, patch) {
  const current = await readServices();
  const idx = current.findIndex((service) => service.id === id);
  if (idx === -1) return;
  current[idx] = { ...current[idx], ...patch };
  await writeServices(current);
}

// src/service-manager.tsx
var import_jsx_runtime = require("react/jsx-runtime");
function formatModelLabel(modelKey) {
  return modelKey.replaceAll("_", " ");
}
function getModelOptions() {
  const keys = Object.keys(import_api2.AI.Model);
  const uniqueByValue = /* @__PURE__ */ new Map();
  for (const key of keys) {
    const modelValue = import_api2.AI.Model[key];
    if (!uniqueByValue.has(modelValue)) {
      uniqueByValue.set(modelValue, { key: String(key), value: modelValue });
    }
  }
  return Array.from(uniqueByValue.values()).sort(
    (a, b) => a.key.localeCompare(b.key)
  );
}
async function isServerHealthy(port) {
  try {
    const response = await requestJSON("GET", port, "/health");
    return response.statusCode >= 200 && response.statusCode < 300;
  } catch {
    return false;
  }
}
async function stopServer(port) {
  const response = await requestJSON("POST", port, "/kill");
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(
      response.body.error || `Failed with status ${response.statusCode}`
    );
  }
  return response.body.message || "Server stopped";
}
async function requestJSON(method, port, path) {
  return new Promise((resolve, reject) => {
    const req = import_http.default.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: { "Content-Type": "application/json" }
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
      }
    );
    req.on("error", reject);
    req.end();
  });
}
function StartServiceForm(props) {
  const { pop } = (0, import_api2.useNavigation)();
  const modelOptions = (0, import_react.useMemo)(() => getModelOptions(), []);
  const [isSubmitting, setIsSubmitting] = (0, import_react.useState)(false);
  const defaultModel = modelOptions.find((item) => item.key === "Perplexity_Sonar_Pro") || modelOptions[0];
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    import_api2.Form,
    {
      navigationTitle: "Start AI Server",
      actions: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_api2.ActionPanel, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        import_api2.Action.SubmitForm,
        {
          title: "Start Service",
          onSubmit: async (values) => {
            const port = Number(values.port.trim());
            if (!Number.isInteger(port) || port < 1 || port > 65535) {
              await (0, import_api2.showToast)({
                style: import_api2.Toast.Style.Failure,
                title: "Invalid Port",
                message: "Port must be an integer between 1 and 65535"
              });
              return;
            }
            const selected = modelOptions.find(
              (item) => item.key === values.modelKey
            );
            if (!selected) {
              await (0, import_api2.showToast)({
                style: import_api2.Toast.Style.Failure,
                title: "Invalid Model"
              });
              return;
            }
            const alive = await isServerHealthy(port);
            if (alive) {
              await (0, import_api2.showToast)({
                style: import_api2.Toast.Style.Failure,
                title: "Port Already In Use",
                message: `A Raycast AI server is already running on ${port}`
              });
              return;
            }
            setIsSubmitting(true);
            const serviceId = `${Date.now()}-${port}`;
            const record = {
              id: serviceId,
              modelKey: selected.key,
              modelValue: selected.value,
              port,
              status: "starting",
              startedAt: Date.now()
            };
            await upsertService(record);
            const context = {
              serviceId,
              modelKey: selected.key,
              modelValue: selected.value,
              port
            };
            try {
              await (0, import_api2.launchCommand)({
                name: "run-openai-server",
                type: import_api2.LaunchType.Background,
                context
              });
              await (0, import_api2.showToast)({
                style: import_api2.Toast.Style.Success,
                title: "Server Launching",
                message: `${selected.key} on :${port}`
              });
              await props.onStarted();
              pop();
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              await patchService(serviceId, {
                status: "error",
                lastError: message
              });
              await (0, import_api2.showToast)({
                style: import_api2.Toast.Style.Failure,
                title: "Launch Failed",
                message
              });
            } finally {
              setIsSubmitting(false);
            }
          }
        }
      ) }),
      isLoading: isSubmitting,
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          import_api2.Form.Dropdown,
          {
            id: "modelKey",
            title: "Model",
            defaultValue: defaultModel?.key,
            children: modelOptions.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              import_api2.Form.Dropdown.Item,
              {
                value: item.key,
                title: formatModelLabel(item.key),
                keywords: [item.value]
              },
              item.key
            ))
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          import_api2.Form.TextField,
          {
            id: "port",
            title: "Port",
            defaultValue: "1235",
            placeholder: "1235"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_api2.Form.Description, { text: "\u542F\u52A8\u540E\u5C06\u66B4\u9732 /v1/chat/completions \u4EE5\u53CA /chat/completions\u3002" })
      ]
    }
  );
}
function Command() {
  const { push } = (0, import_api2.useNavigation)();
  const [services, setServices] = (0, import_react.useState)([]);
  const [isLoading, setIsLoading] = (0, import_react.useState)(true);
  const refresh = (0, import_react.useCallback)(async () => {
    setIsLoading(true);
    const existing = await readServices();
    const next = await Promise.all(
      existing.map(async (service) => {
        const healthy = await isServerHealthy(service.port);
        if (healthy) {
          return {
            ...service,
            status: "running",
            lastError: void 0
          };
        }
        if (service.status === "starting" || service.status === "running") {
          return { ...service, status: "stopped" };
        }
        return service;
      })
    );
    for (const service of next) {
      await upsertService(service);
    }
    setServices(next.sort((a, b) => b.startedAt - a.startedAt));
    setIsLoading(false);
  }, []);
  (0, import_react.useEffect)(() => {
    refresh();
  }, [refresh]);
  const runningCount = services.filter(
    (item) => item.status === "running"
  ).length;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    import_api2.List,
    {
      isLoading,
      searchBarPlaceholder: "Search services...",
      navigationTitle: "Raycast AI Server",
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_api2.List.Section, { title: "Actions", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          import_api2.List.Item,
          {
            title: "Start New Service",
            icon: import_api2.Icon.Play,
            accessories: [{ text: `${runningCount} running` }],
            actions: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_api2.ActionPanel, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                import_api2.Action,
                {
                  title: "Start Service",
                  icon: import_api2.Icon.Play,
                  onAction: () => push(/* @__PURE__ */ (0, import_jsx_runtime.jsx)(StartServiceForm, { onStarted: refresh }))
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                import_api2.Action,
                {
                  title: "Refresh",
                  icon: import_api2.Icon.ArrowClockwise,
                  onAction: refresh
                }
              )
            ] })
          }
        ) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
          import_api2.List.Section,
          {
            title: "Services",
            subtitle: services.length > 0 ? String(services.length) : void 0,
            children: [
              services.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                import_api2.List.Item,
                {
                  title: "No Service Yet",
                  subtitle: "Start your first local OpenAI-compatible server",
                  icon: import_api2.Icon.Dot,
                  actions: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_api2.ActionPanel, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    import_api2.Action,
                    {
                      title: "Start Service",
                      onAction: () => push(/* @__PURE__ */ (0, import_jsx_runtime.jsx)(StartServiceForm, { onStarted: refresh }))
                    }
                  ) })
                }
              ) : null,
              services.map((service) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                import_api2.List.Item,
                {
                  title: `${formatModelLabel(service.modelKey)}  :${service.port}`,
                  subtitle: service.modelValue,
                  icon: service.status === "running" ? import_api2.Icon.CheckCircle : service.status === "starting" ? import_api2.Icon.Clock : service.status === "error" ? import_api2.Icon.ExclamationMark : import_api2.Icon.Stop,
                  accessories: [
                    { text: service.status },
                    { date: new Date(service.startedAt), tooltip: "Created At" }
                  ],
                  actions: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_api2.ActionPanel, { children: [
                    service.status === "running" || service.status === "starting" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                      import_api2.Action,
                      {
                        title: "Stop Service",
                        icon: import_api2.Icon.Stop,
                        onAction: async () => {
                          try {
                            const message = await stopServer(service.port);
                            await patchService(service.id, {
                              status: "stopped",
                              lastError: void 0
                            });
                            await (0, import_api2.showToast)({
                              style: import_api2.Toast.Style.Success,
                              title: "Service Stopped",
                              message
                            });
                            await refresh();
                          } catch (error) {
                            const message = error instanceof Error ? error.message : String(error);
                            await patchService(service.id, {
                              status: "error",
                              lastError: message
                            });
                            await (0, import_api2.showToast)({
                              style: import_api2.Toast.Style.Failure,
                              title: "Stop Failed",
                              message
                            });
                          }
                        }
                      }
                    ) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                      import_api2.Action,
                      {
                        title: "Mark as Stopped",
                        icon: import_api2.Icon.Stop,
                        onAction: async () => {
                          await patchService(service.id, { status: "stopped" });
                          await refresh();
                        }
                      }
                    ),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                      import_api2.Action,
                      {
                        title: "Restart Service",
                        icon: import_api2.Icon.ArrowClockwise,
                        onAction: async () => {
                          if (service.status === "running") {
                            try {
                              await stopServer(service.port);
                            } catch {
                            }
                          }
                          await patchService(service.id, {
                            status: "starting",
                            lastError: void 0,
                            startedAt: Date.now()
                          });
                          const context = {
                            serviceId: service.id,
                            modelKey: service.modelKey,
                            modelValue: service.modelValue,
                            port: service.port
                          };
                          await (0, import_api2.launchCommand)({
                            name: "run-openai-server",
                            type: import_api2.LaunchType.Background,
                            context
                          });
                          await (0, import_api2.showToast)({
                            style: import_api2.Toast.Style.Success,
                            title: "Service Restarted",
                            message: `${service.modelKey} on :${service.port}`
                          });
                          await refresh();
                          await (0, import_api2.popToRoot)({ clearSearchBar: true });
                        }
                      }
                    ),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                      import_api2.Action,
                      {
                        title: "Refresh",
                        icon: import_api2.Icon.ArrowClockwise,
                        onAction: refresh
                      }
                    )
                  ] })
                },
                service.id
              ))
            ]
          }
        )
      ]
    }
  );
}
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3NlcnZpY2UtbWFuYWdlci50c3giLCAiLi4vc3JjL3N0b3JhZ2UudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImltcG9ydCB7XG4gIEFjdGlvbixcbiAgQWN0aW9uUGFuZWwsXG4gIEFJLFxuICBGb3JtLFxuICBJY29uLFxuICBMYXVuY2hUeXBlLFxuICBMaXN0LFxuICBUb2FzdCxcbiAgbGF1bmNoQ29tbWFuZCxcbiAgcG9wVG9Sb290LFxuICBzaG93VG9hc3QsXG4gIHVzZU5hdmlnYXRpb24sXG59IGZyb20gXCJAcmF5Y2FzdC9hcGlcIjtcbmltcG9ydCBodHRwIGZyb20gXCJodHRwXCI7XG5pbXBvcnQgeyB1c2VDYWxsYmFjaywgdXNlRWZmZWN0LCB1c2VNZW1vLCB1c2VTdGF0ZSB9IGZyb20gXCJyZWFjdFwiO1xuaW1wb3J0IHsgcGF0Y2hTZXJ2aWNlLCByZWFkU2VydmljZXMsIHVwc2VydFNlcnZpY2UgfSBmcm9tIFwiLi9zdG9yYWdlXCI7XG5pbXBvcnQgdHlwZSB7IE1hbmFnZWRTZXJ2aWNlLCBTZXJ2ZXJMYXVuY2hDb250ZXh0IH0gZnJvbSBcIi4vdHlwZXNcIjtcblxuZnVuY3Rpb24gZm9ybWF0TW9kZWxMYWJlbChtb2RlbEtleTogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIG1vZGVsS2V5LnJlcGxhY2VBbGwoXCJfXCIsIFwiIFwiKTtcbn1cblxuZnVuY3Rpb24gZ2V0TW9kZWxPcHRpb25zKCkge1xuICBjb25zdCBrZXlzID0gT2JqZWN0LmtleXMoQUkuTW9kZWwpIGFzIEFycmF5PGtleW9mIHR5cGVvZiBBSS5Nb2RlbD47XG4gIGNvbnN0IHVuaXF1ZUJ5VmFsdWUgPSBuZXcgTWFwPHN0cmluZywgeyBrZXk6IHN0cmluZzsgdmFsdWU6IHN0cmluZyB9PigpO1xuXG4gIGZvciAoY29uc3Qga2V5IG9mIGtleXMpIHtcbiAgICBjb25zdCBtb2RlbFZhbHVlID0gQUkuTW9kZWxba2V5XTtcbiAgICBpZiAoIXVuaXF1ZUJ5VmFsdWUuaGFzKG1vZGVsVmFsdWUpKSB7XG4gICAgICB1bmlxdWVCeVZhbHVlLnNldChtb2RlbFZhbHVlLCB7IGtleTogU3RyaW5nKGtleSksIHZhbHVlOiBtb2RlbFZhbHVlIH0pO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBBcnJheS5mcm9tKHVuaXF1ZUJ5VmFsdWUudmFsdWVzKCkpLnNvcnQoKGEsIGIpID0+XG4gICAgYS5rZXkubG9jYWxlQ29tcGFyZShiLmtleSksXG4gICk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGlzU2VydmVySGVhbHRoeShwb3J0OiBudW1iZXIpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgdHJ5IHtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHJlcXVlc3RKU09OKFwiR0VUXCIsIHBvcnQsIFwiL2hlYWx0aFwiKTtcbiAgICByZXR1cm4gcmVzcG9uc2Uuc3RhdHVzQ29kZSA+PSAyMDAgJiYgcmVzcG9uc2Uuc3RhdHVzQ29kZSA8IDMwMDtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHN0b3BTZXJ2ZXIocG9ydDogbnVtYmVyKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCByZXF1ZXN0SlNPTihcIlBPU1RcIiwgcG9ydCwgXCIva2lsbFwiKTtcbiAgaWYgKHJlc3BvbnNlLnN0YXR1c0NvZGUgPCAyMDAgfHwgcmVzcG9uc2Uuc3RhdHVzQ29kZSA+PSAzMDApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICByZXNwb25zZS5ib2R5LmVycm9yIHx8IGBGYWlsZWQgd2l0aCBzdGF0dXMgJHtyZXNwb25zZS5zdGF0dXNDb2RlfWAsXG4gICAgKTtcbiAgfVxuICByZXR1cm4gcmVzcG9uc2UuYm9keS5tZXNzYWdlIHx8IFwiU2VydmVyIHN0b3BwZWRcIjtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVxdWVzdEpTT04oXG4gIG1ldGhvZDogXCJHRVRcIiB8IFwiUE9TVFwiLFxuICBwb3J0OiBudW1iZXIsXG4gIHBhdGg6IHN0cmluZyxcbik6IFByb21pc2U8eyBzdGF0dXNDb2RlOiBudW1iZXI7IGJvZHk6IGFueSB9PiB7XG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgY29uc3QgcmVxID0gaHR0cC5yZXF1ZXN0KFxuICAgICAge1xuICAgICAgICBob3N0bmFtZTogXCIxMjcuMC4wLjFcIixcbiAgICAgICAgcG9ydCxcbiAgICAgICAgcGF0aCxcbiAgICAgICAgbWV0aG9kLFxuICAgICAgICBoZWFkZXJzOiB7IFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiIH0sXG4gICAgICB9LFxuICAgICAgKHJlcykgPT4ge1xuICAgICAgICBsZXQgcmF3ID0gXCJcIjtcbiAgICAgICAgcmVzLm9uKFwiZGF0YVwiLCAoY2h1bmspID0+IHtcbiAgICAgICAgICByYXcgKz0gY2h1bmsudG9TdHJpbmcoKTtcbiAgICAgICAgfSk7XG4gICAgICAgIHJlcy5vbihcImVuZFwiLCAoKSA9PiB7XG4gICAgICAgICAgY29uc3Qgc3RhdHVzQ29kZSA9IHJlcy5zdGF0dXNDb2RlIHx8IDUwMDtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgYm9keSA9IHJhdyA/IEpTT04ucGFyc2UocmF3KSA6IHt9O1xuICAgICAgICAgICAgcmVzb2x2ZSh7IHN0YXR1c0NvZGUsIGJvZHkgfSk7XG4gICAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgICByZXNvbHZlKHsgc3RhdHVzQ29kZSwgYm9keTogeyBtZXNzYWdlOiByYXcgfSB9KTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfSxcbiAgICApO1xuICAgIHJlcS5vbihcImVycm9yXCIsIHJlamVjdCk7XG4gICAgcmVxLmVuZCgpO1xuICB9KTtcbn1cblxuZnVuY3Rpb24gU3RhcnRTZXJ2aWNlRm9ybShwcm9wczogeyBvblN0YXJ0ZWQ6ICgpID0+IFByb21pc2U8dm9pZD4gfSkge1xuICBjb25zdCB7IHBvcCB9ID0gdXNlTmF2aWdhdGlvbigpO1xuICBjb25zdCBtb2RlbE9wdGlvbnMgPSB1c2VNZW1vKCgpID0+IGdldE1vZGVsT3B0aW9ucygpLCBbXSk7XG4gIGNvbnN0IFtpc1N1Ym1pdHRpbmcsIHNldElzU3VibWl0dGluZ10gPSB1c2VTdGF0ZShmYWxzZSk7XG5cbiAgY29uc3QgZGVmYXVsdE1vZGVsID1cbiAgICBtb2RlbE9wdGlvbnMuZmluZCgoaXRlbSkgPT4gaXRlbS5rZXkgPT09IFwiUGVycGxleGl0eV9Tb25hcl9Qcm9cIikgfHxcbiAgICBtb2RlbE9wdGlvbnNbMF07XG5cbiAgcmV0dXJuIChcbiAgICA8Rm9ybVxuICAgICAgbmF2aWdhdGlvblRpdGxlPVwiU3RhcnQgQUkgU2VydmVyXCJcbiAgICAgIGFjdGlvbnM9e1xuICAgICAgICA8QWN0aW9uUGFuZWw+XG4gICAgICAgICAgPEFjdGlvbi5TdWJtaXRGb3JtXG4gICAgICAgICAgICB0aXRsZT1cIlN0YXJ0IFNlcnZpY2VcIlxuICAgICAgICAgICAgb25TdWJtaXQ9e2FzeW5jICh2YWx1ZXM6IHsgbW9kZWxLZXk6IHN0cmluZzsgcG9ydDogc3RyaW5nIH0pID0+IHtcbiAgICAgICAgICAgICAgY29uc3QgcG9ydCA9IE51bWJlcih2YWx1ZXMucG9ydC50cmltKCkpO1xuICAgICAgICAgICAgICBpZiAoIU51bWJlci5pc0ludGVnZXIocG9ydCkgfHwgcG9ydCA8IDEgfHwgcG9ydCA+IDY1NTM1KSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgc2hvd1RvYXN0KHtcbiAgICAgICAgICAgICAgICAgIHN0eWxlOiBUb2FzdC5TdHlsZS5GYWlsdXJlLFxuICAgICAgICAgICAgICAgICAgdGl0bGU6IFwiSW52YWxpZCBQb3J0XCIsXG4gICAgICAgICAgICAgICAgICBtZXNzYWdlOiBcIlBvcnQgbXVzdCBiZSBhbiBpbnRlZ2VyIGJldHdlZW4gMSBhbmQgNjU1MzVcIixcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICBjb25zdCBzZWxlY3RlZCA9IG1vZGVsT3B0aW9ucy5maW5kKFxuICAgICAgICAgICAgICAgIChpdGVtKSA9PiBpdGVtLmtleSA9PT0gdmFsdWVzLm1vZGVsS2V5LFxuICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICBpZiAoIXNlbGVjdGVkKSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgc2hvd1RvYXN0KHtcbiAgICAgICAgICAgICAgICAgIHN0eWxlOiBUb2FzdC5TdHlsZS5GYWlsdXJlLFxuICAgICAgICAgICAgICAgICAgdGl0bGU6IFwiSW52YWxpZCBNb2RlbFwiLFxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgIGNvbnN0IGFsaXZlID0gYXdhaXQgaXNTZXJ2ZXJIZWFsdGh5KHBvcnQpO1xuICAgICAgICAgICAgICBpZiAoYWxpdmUpIHtcbiAgICAgICAgICAgICAgICBhd2FpdCBzaG93VG9hc3Qoe1xuICAgICAgICAgICAgICAgICAgc3R5bGU6IFRvYXN0LlN0eWxlLkZhaWx1cmUsXG4gICAgICAgICAgICAgICAgICB0aXRsZTogXCJQb3J0IEFscmVhZHkgSW4gVXNlXCIsXG4gICAgICAgICAgICAgICAgICBtZXNzYWdlOiBgQSBSYXljYXN0IEFJIHNlcnZlciBpcyBhbHJlYWR5IHJ1bm5pbmcgb24gJHtwb3J0fWAsXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgc2V0SXNTdWJtaXR0aW5nKHRydWUpO1xuICAgICAgICAgICAgICBjb25zdCBzZXJ2aWNlSWQgPSBgJHtEYXRlLm5vdygpfS0ke3BvcnR9YDtcblxuICAgICAgICAgICAgICBjb25zdCByZWNvcmQ6IE1hbmFnZWRTZXJ2aWNlID0ge1xuICAgICAgICAgICAgICAgIGlkOiBzZXJ2aWNlSWQsXG4gICAgICAgICAgICAgICAgbW9kZWxLZXk6IHNlbGVjdGVkLmtleSxcbiAgICAgICAgICAgICAgICBtb2RlbFZhbHVlOiBzZWxlY3RlZC52YWx1ZSxcbiAgICAgICAgICAgICAgICBwb3J0LFxuICAgICAgICAgICAgICAgIHN0YXR1czogXCJzdGFydGluZ1wiLFxuICAgICAgICAgICAgICAgIHN0YXJ0ZWRBdDogRGF0ZS5ub3coKSxcbiAgICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgICBhd2FpdCB1cHNlcnRTZXJ2aWNlKHJlY29yZCk7XG5cbiAgICAgICAgICAgICAgY29uc3QgY29udGV4dDogU2VydmVyTGF1bmNoQ29udGV4dCA9IHtcbiAgICAgICAgICAgICAgICBzZXJ2aWNlSWQsXG4gICAgICAgICAgICAgICAgbW9kZWxLZXk6IHNlbGVjdGVkLmtleSxcbiAgICAgICAgICAgICAgICBtb2RlbFZhbHVlOiBzZWxlY3RlZC52YWx1ZSxcbiAgICAgICAgICAgICAgICBwb3J0LFxuICAgICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgbGF1bmNoQ29tbWFuZCh7XG4gICAgICAgICAgICAgICAgICBuYW1lOiBcInJ1bi1vcGVuYWktc2VydmVyXCIsXG4gICAgICAgICAgICAgICAgICB0eXBlOiBMYXVuY2hUeXBlLkJhY2tncm91bmQsXG4gICAgICAgICAgICAgICAgICBjb250ZXh0LFxuICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAgICAgYXdhaXQgc2hvd1RvYXN0KHtcbiAgICAgICAgICAgICAgICAgIHN0eWxlOiBUb2FzdC5TdHlsZS5TdWNjZXNzLFxuICAgICAgICAgICAgICAgICAgdGl0bGU6IFwiU2VydmVyIExhdW5jaGluZ1wiLFxuICAgICAgICAgICAgICAgICAgbWVzc2FnZTogYCR7c2VsZWN0ZWQua2V5fSBvbiA6JHtwb3J0fWAsXG4gICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgICBhd2FpdCBwcm9wcy5vblN0YXJ0ZWQoKTtcbiAgICAgICAgICAgICAgICBwb3AoKTtcbiAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBtZXNzYWdlID1cbiAgICAgICAgICAgICAgICAgIGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKTtcbiAgICAgICAgICAgICAgICBhd2FpdCBwYXRjaFNlcnZpY2Uoc2VydmljZUlkLCB7XG4gICAgICAgICAgICAgICAgICBzdGF0dXM6IFwiZXJyb3JcIixcbiAgICAgICAgICAgICAgICAgIGxhc3RFcnJvcjogbWVzc2FnZSxcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICBhd2FpdCBzaG93VG9hc3Qoe1xuICAgICAgICAgICAgICAgICAgc3R5bGU6IFRvYXN0LlN0eWxlLkZhaWx1cmUsXG4gICAgICAgICAgICAgICAgICB0aXRsZTogXCJMYXVuY2ggRmFpbGVkXCIsXG4gICAgICAgICAgICAgICAgICBtZXNzYWdlLFxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgICAgICAgIHNldElzU3VibWl0dGluZyhmYWxzZSk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH19XG4gICAgICAgICAgLz5cbiAgICAgICAgPC9BY3Rpb25QYW5lbD5cbiAgICAgIH1cbiAgICAgIGlzTG9hZGluZz17aXNTdWJtaXR0aW5nfVxuICAgID5cbiAgICAgIDxGb3JtLkRyb3Bkb3duXG4gICAgICAgIGlkPVwibW9kZWxLZXlcIlxuICAgICAgICB0aXRsZT1cIk1vZGVsXCJcbiAgICAgICAgZGVmYXVsdFZhbHVlPXtkZWZhdWx0TW9kZWw/LmtleX1cbiAgICAgID5cbiAgICAgICAge21vZGVsT3B0aW9ucy5tYXAoKGl0ZW0pID0+IChcbiAgICAgICAgICA8Rm9ybS5Ecm9wZG93bi5JdGVtXG4gICAgICAgICAgICBrZXk9e2l0ZW0ua2V5fVxuICAgICAgICAgICAgdmFsdWU9e2l0ZW0ua2V5fVxuICAgICAgICAgICAgdGl0bGU9e2Zvcm1hdE1vZGVsTGFiZWwoaXRlbS5rZXkpfVxuICAgICAgICAgICAga2V5d29yZHM9e1tpdGVtLnZhbHVlXX1cbiAgICAgICAgICAvPlxuICAgICAgICApKX1cbiAgICAgIDwvRm9ybS5Ecm9wZG93bj5cbiAgICAgIDxGb3JtLlRleHRGaWVsZFxuICAgICAgICBpZD1cInBvcnRcIlxuICAgICAgICB0aXRsZT1cIlBvcnRcIlxuICAgICAgICBkZWZhdWx0VmFsdWU9XCIxMjM1XCJcbiAgICAgICAgcGxhY2Vob2xkZXI9XCIxMjM1XCJcbiAgICAgIC8+XG4gICAgICA8Rm9ybS5EZXNjcmlwdGlvbiB0ZXh0PVwiXHU1NDJGXHU1MkE4XHU1NDBFXHU1QzA2XHU2NkI0XHU5NzMyIC92MS9jaGF0L2NvbXBsZXRpb25zIFx1NEVFNVx1NTNDQSAvY2hhdC9jb21wbGV0aW9uc1x1MzAwMlwiIC8+XG4gICAgPC9Gb3JtPlxuICApO1xufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBDb21tYW5kKCkge1xuICBjb25zdCB7IHB1c2ggfSA9IHVzZU5hdmlnYXRpb24oKTtcbiAgY29uc3QgW3NlcnZpY2VzLCBzZXRTZXJ2aWNlc10gPSB1c2VTdGF0ZTxNYW5hZ2VkU2VydmljZVtdPihbXSk7XG4gIGNvbnN0IFtpc0xvYWRpbmcsIHNldElzTG9hZGluZ10gPSB1c2VTdGF0ZSh0cnVlKTtcblxuICBjb25zdCByZWZyZXNoID0gdXNlQ2FsbGJhY2soYXN5bmMgKCkgPT4ge1xuICAgIHNldElzTG9hZGluZyh0cnVlKTtcbiAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IHJlYWRTZXJ2aWNlcygpO1xuXG4gICAgY29uc3QgbmV4dCA9IGF3YWl0IFByb21pc2UuYWxsKFxuICAgICAgZXhpc3RpbmcubWFwKGFzeW5jIChzZXJ2aWNlKSA9PiB7XG4gICAgICAgIGNvbnN0IGhlYWx0aHkgPSBhd2FpdCBpc1NlcnZlckhlYWx0aHkoc2VydmljZS5wb3J0KTtcbiAgICAgICAgaWYgKGhlYWx0aHkpIHtcbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgLi4uc2VydmljZSxcbiAgICAgICAgICAgIHN0YXR1czogXCJydW5uaW5nXCIgYXMgY29uc3QsXG4gICAgICAgICAgICBsYXN0RXJyb3I6IHVuZGVmaW5lZCxcbiAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICAgIGlmIChzZXJ2aWNlLnN0YXR1cyA9PT0gXCJzdGFydGluZ1wiIHx8IHNlcnZpY2Uuc3RhdHVzID09PSBcInJ1bm5pbmdcIikge1xuICAgICAgICAgIHJldHVybiB7IC4uLnNlcnZpY2UsIHN0YXR1czogXCJzdG9wcGVkXCIgYXMgY29uc3QgfTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gc2VydmljZTtcbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICBmb3IgKGNvbnN0IHNlcnZpY2Ugb2YgbmV4dCkge1xuICAgICAgYXdhaXQgdXBzZXJ0U2VydmljZShzZXJ2aWNlKTtcbiAgICB9XG5cbiAgICBzZXRTZXJ2aWNlcyhuZXh0LnNvcnQoKGEsIGIpID0+IGIuc3RhcnRlZEF0IC0gYS5zdGFydGVkQXQpKTtcbiAgICBzZXRJc0xvYWRpbmcoZmFsc2UpO1xuICB9LCBbXSk7XG5cbiAgdXNlRWZmZWN0KCgpID0+IHtcbiAgICByZWZyZXNoKCk7XG4gIH0sIFtyZWZyZXNoXSk7XG5cbiAgY29uc3QgcnVubmluZ0NvdW50ID0gc2VydmljZXMuZmlsdGVyKFxuICAgIChpdGVtKSA9PiBpdGVtLnN0YXR1cyA9PT0gXCJydW5uaW5nXCIsXG4gICkubGVuZ3RoO1xuXG4gIHJldHVybiAoXG4gICAgPExpc3RcbiAgICAgIGlzTG9hZGluZz17aXNMb2FkaW5nfVxuICAgICAgc2VhcmNoQmFyUGxhY2Vob2xkZXI9XCJTZWFyY2ggc2VydmljZXMuLi5cIlxuICAgICAgbmF2aWdhdGlvblRpdGxlPVwiUmF5Y2FzdCBBSSBTZXJ2ZXJcIlxuICAgID5cbiAgICAgIDxMaXN0LlNlY3Rpb24gdGl0bGU9XCJBY3Rpb25zXCI+XG4gICAgICAgIDxMaXN0Lkl0ZW1cbiAgICAgICAgICB0aXRsZT1cIlN0YXJ0IE5ldyBTZXJ2aWNlXCJcbiAgICAgICAgICBpY29uPXtJY29uLlBsYXl9XG4gICAgICAgICAgYWNjZXNzb3JpZXM9e1t7IHRleHQ6IGAke3J1bm5pbmdDb3VudH0gcnVubmluZ2AgfV19XG4gICAgICAgICAgYWN0aW9ucz17XG4gICAgICAgICAgICA8QWN0aW9uUGFuZWw+XG4gICAgICAgICAgICAgIDxBY3Rpb25cbiAgICAgICAgICAgICAgICB0aXRsZT1cIlN0YXJ0IFNlcnZpY2VcIlxuICAgICAgICAgICAgICAgIGljb249e0ljb24uUGxheX1cbiAgICAgICAgICAgICAgICBvbkFjdGlvbj17KCkgPT4gcHVzaCg8U3RhcnRTZXJ2aWNlRm9ybSBvblN0YXJ0ZWQ9e3JlZnJlc2h9IC8+KX1cbiAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgPEFjdGlvblxuICAgICAgICAgICAgICAgIHRpdGxlPVwiUmVmcmVzaFwiXG4gICAgICAgICAgICAgICAgaWNvbj17SWNvbi5BcnJvd0Nsb2Nrd2lzZX1cbiAgICAgICAgICAgICAgICBvbkFjdGlvbj17cmVmcmVzaH1cbiAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgIDwvQWN0aW9uUGFuZWw+XG4gICAgICAgICAgfVxuICAgICAgICAvPlxuICAgICAgPC9MaXN0LlNlY3Rpb24+XG5cbiAgICAgIDxMaXN0LlNlY3Rpb25cbiAgICAgICAgdGl0bGU9XCJTZXJ2aWNlc1wiXG4gICAgICAgIHN1YnRpdGxlPXtzZXJ2aWNlcy5sZW5ndGggPiAwID8gU3RyaW5nKHNlcnZpY2VzLmxlbmd0aCkgOiB1bmRlZmluZWR9XG4gICAgICA+XG4gICAgICAgIHtzZXJ2aWNlcy5sZW5ndGggPT09IDAgPyAoXG4gICAgICAgICAgPExpc3QuSXRlbVxuICAgICAgICAgICAgdGl0bGU9XCJObyBTZXJ2aWNlIFlldFwiXG4gICAgICAgICAgICBzdWJ0aXRsZT1cIlN0YXJ0IHlvdXIgZmlyc3QgbG9jYWwgT3BlbkFJLWNvbXBhdGlibGUgc2VydmVyXCJcbiAgICAgICAgICAgIGljb249e0ljb24uRG90fVxuICAgICAgICAgICAgYWN0aW9ucz17XG4gICAgICAgICAgICAgIDxBY3Rpb25QYW5lbD5cbiAgICAgICAgICAgICAgICA8QWN0aW9uXG4gICAgICAgICAgICAgICAgICB0aXRsZT1cIlN0YXJ0IFNlcnZpY2VcIlxuICAgICAgICAgICAgICAgICAgb25BY3Rpb249eygpID0+XG4gICAgICAgICAgICAgICAgICAgIHB1c2goPFN0YXJ0U2VydmljZUZvcm0gb25TdGFydGVkPXtyZWZyZXNofSAvPilcbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICA8L0FjdGlvblBhbmVsPlxuICAgICAgICAgICAgfVxuICAgICAgICAgIC8+XG4gICAgICAgICkgOiBudWxsfVxuXG4gICAgICAgIHtzZXJ2aWNlcy5tYXAoKHNlcnZpY2UpID0+IChcbiAgICAgICAgICA8TGlzdC5JdGVtXG4gICAgICAgICAgICBrZXk9e3NlcnZpY2UuaWR9XG4gICAgICAgICAgICB0aXRsZT17YCR7Zm9ybWF0TW9kZWxMYWJlbChzZXJ2aWNlLm1vZGVsS2V5KX0gIDoke3NlcnZpY2UucG9ydH1gfVxuICAgICAgICAgICAgc3VidGl0bGU9e3NlcnZpY2UubW9kZWxWYWx1ZX1cbiAgICAgICAgICAgIGljb249e1xuICAgICAgICAgICAgICBzZXJ2aWNlLnN0YXR1cyA9PT0gXCJydW5uaW5nXCJcbiAgICAgICAgICAgICAgICA/IEljb24uQ2hlY2tDaXJjbGVcbiAgICAgICAgICAgICAgICA6IHNlcnZpY2Uuc3RhdHVzID09PSBcInN0YXJ0aW5nXCJcbiAgICAgICAgICAgICAgICAgID8gSWNvbi5DbG9ja1xuICAgICAgICAgICAgICAgICAgOiBzZXJ2aWNlLnN0YXR1cyA9PT0gXCJlcnJvclwiXG4gICAgICAgICAgICAgICAgICAgID8gSWNvbi5FeGNsYW1hdGlvbk1hcmtcbiAgICAgICAgICAgICAgICAgICAgOiBJY29uLlN0b3BcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGFjY2Vzc29yaWVzPXtbXG4gICAgICAgICAgICAgIHsgdGV4dDogc2VydmljZS5zdGF0dXMgfSxcbiAgICAgICAgICAgICAgeyBkYXRlOiBuZXcgRGF0ZShzZXJ2aWNlLnN0YXJ0ZWRBdCksIHRvb2x0aXA6IFwiQ3JlYXRlZCBBdFwiIH0sXG4gICAgICAgICAgICBdfVxuICAgICAgICAgICAgYWN0aW9ucz17XG4gICAgICAgICAgICAgIDxBY3Rpb25QYW5lbD5cbiAgICAgICAgICAgICAgICB7c2VydmljZS5zdGF0dXMgPT09IFwicnVubmluZ1wiIHx8XG4gICAgICAgICAgICAgICAgc2VydmljZS5zdGF0dXMgPT09IFwic3RhcnRpbmdcIiA/IChcbiAgICAgICAgICAgICAgICAgIDxBY3Rpb25cbiAgICAgICAgICAgICAgICAgICAgdGl0bGU9XCJTdG9wIFNlcnZpY2VcIlxuICAgICAgICAgICAgICAgICAgICBpY29uPXtJY29uLlN0b3B9XG4gICAgICAgICAgICAgICAgICAgIG9uQWN0aW9uPXthc3luYyAoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IG1lc3NhZ2UgPSBhd2FpdCBzdG9wU2VydmVyKHNlcnZpY2UucG9ydCk7XG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBwYXRjaFNlcnZpY2Uoc2VydmljZS5pZCwge1xuICAgICAgICAgICAgICAgICAgICAgICAgICBzdGF0dXM6IFwic3RvcHBlZFwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgICBsYXN0RXJyb3I6IHVuZGVmaW5lZCxcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgc2hvd1RvYXN0KHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgc3R5bGU6IFRvYXN0LlN0eWxlLlN1Y2Nlc3MsXG4gICAgICAgICAgICAgICAgICAgICAgICAgIHRpdGxlOiBcIlNlcnZpY2UgU3RvcHBlZFwiLFxuICAgICAgICAgICAgICAgICAgICAgICAgICBtZXNzYWdlLFxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCByZWZyZXNoKCk7XG4gICAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IG1lc3NhZ2UgPVxuICAgICAgICAgICAgICAgICAgICAgICAgICBlcnJvciBpbnN0YW5jZW9mIEVycm9yXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPyBlcnJvci5tZXNzYWdlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgOiBTdHJpbmcoZXJyb3IpO1xuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgcGF0Y2hTZXJ2aWNlKHNlcnZpY2UuaWQsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgc3RhdHVzOiBcImVycm9yXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGxhc3RFcnJvcjogbWVzc2FnZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgc2hvd1RvYXN0KHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgc3R5bGU6IFRvYXN0LlN0eWxlLkZhaWx1cmUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgIHRpdGxlOiBcIlN0b3AgRmFpbGVkXCIsXG4gICAgICAgICAgICAgICAgICAgICAgICAgIG1lc3NhZ2UsXG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH19XG4gICAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICAgICkgOiAoXG4gICAgICAgICAgICAgICAgICA8QWN0aW9uXG4gICAgICAgICAgICAgICAgICAgIHRpdGxlPVwiTWFyayBhcyBTdG9wcGVkXCJcbiAgICAgICAgICAgICAgICAgICAgaWNvbj17SWNvbi5TdG9wfVxuICAgICAgICAgICAgICAgICAgICBvbkFjdGlvbj17YXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IHBhdGNoU2VydmljZShzZXJ2aWNlLmlkLCB7IHN0YXR1czogXCJzdG9wcGVkXCIgfSk7XG4gICAgICAgICAgICAgICAgICAgICAgYXdhaXQgcmVmcmVzaCgpO1xuICAgICAgICAgICAgICAgICAgICB9fVxuICAgICAgICAgICAgICAgICAgLz5cbiAgICAgICAgICAgICAgICApfVxuICAgICAgICAgICAgICAgIDxBY3Rpb25cbiAgICAgICAgICAgICAgICAgIHRpdGxlPVwiUmVzdGFydCBTZXJ2aWNlXCJcbiAgICAgICAgICAgICAgICAgIGljb249e0ljb24uQXJyb3dDbG9ja3dpc2V9XG4gICAgICAgICAgICAgICAgICBvbkFjdGlvbj17YXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBpZiAoc2VydmljZS5zdGF0dXMgPT09IFwicnVubmluZ1wiKSB7XG4gICAgICAgICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IHN0b3BTZXJ2ZXIoc2VydmljZS5wb3J0KTtcbiAgICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIElnbm9yZTsgcmVzdGFydCB3aWxsIHN0aWxsIHRyeSB0byBsYXVuY2guXG4gICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgcGF0Y2hTZXJ2aWNlKHNlcnZpY2UuaWQsIHtcbiAgICAgICAgICAgICAgICAgICAgICBzdGF0dXM6IFwic3RhcnRpbmdcIixcbiAgICAgICAgICAgICAgICAgICAgICBsYXN0RXJyb3I6IHVuZGVmaW5lZCxcbiAgICAgICAgICAgICAgICAgICAgICBzdGFydGVkQXQ6IERhdGUubm93KCksXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGNvbnRleHQ6IFNlcnZlckxhdW5jaENvbnRleHQgPSB7XG4gICAgICAgICAgICAgICAgICAgICAgc2VydmljZUlkOiBzZXJ2aWNlLmlkLFxuICAgICAgICAgICAgICAgICAgICAgIG1vZGVsS2V5OiBzZXJ2aWNlLm1vZGVsS2V5LFxuICAgICAgICAgICAgICAgICAgICAgIG1vZGVsVmFsdWU6IHNlcnZpY2UubW9kZWxWYWx1ZSxcbiAgICAgICAgICAgICAgICAgICAgICBwb3J0OiBzZXJ2aWNlLnBvcnQsXG4gICAgICAgICAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgbGF1bmNoQ29tbWFuZCh7XG4gICAgICAgICAgICAgICAgICAgICAgbmFtZTogXCJydW4tb3BlbmFpLXNlcnZlclwiLFxuICAgICAgICAgICAgICAgICAgICAgIHR5cGU6IExhdW5jaFR5cGUuQmFja2dyb3VuZCxcbiAgICAgICAgICAgICAgICAgICAgICBjb250ZXh0LFxuICAgICAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgICAgICBhd2FpdCBzaG93VG9hc3Qoe1xuICAgICAgICAgICAgICAgICAgICAgIHN0eWxlOiBUb2FzdC5TdHlsZS5TdWNjZXNzLFxuICAgICAgICAgICAgICAgICAgICAgIHRpdGxlOiBcIlNlcnZpY2UgUmVzdGFydGVkXCIsXG4gICAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogYCR7c2VydmljZS5tb2RlbEtleX0gb24gOiR7c2VydmljZS5wb3J0fWAsXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IHJlZnJlc2goKTtcbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgcG9wVG9Sb290KHsgY2xlYXJTZWFyY2hCYXI6IHRydWUgfSk7XG4gICAgICAgICAgICAgICAgICB9fVxuICAgICAgICAgICAgICAgIC8+XG4gICAgICAgICAgICAgICAgPEFjdGlvblxuICAgICAgICAgICAgICAgICAgdGl0bGU9XCJSZWZyZXNoXCJcbiAgICAgICAgICAgICAgICAgIGljb249e0ljb24uQXJyb3dDbG9ja3dpc2V9XG4gICAgICAgICAgICAgICAgICBvbkFjdGlvbj17cmVmcmVzaH1cbiAgICAgICAgICAgICAgICAvPlxuICAgICAgICAgICAgICA8L0FjdGlvblBhbmVsPlxuICAgICAgICAgICAgfVxuICAgICAgICAgIC8+XG4gICAgICAgICkpfVxuICAgICAgPC9MaXN0LlNlY3Rpb24+XG4gICAgPC9MaXN0PlxuICApO1xufVxuIiwgImltcG9ydCB7IExvY2FsU3RvcmFnZSB9IGZyb20gXCJAcmF5Y2FzdC9hcGlcIjtcbmltcG9ydCB0eXBlIHsgTWFuYWdlZFNlcnZpY2UgfSBmcm9tIFwiLi90eXBlc1wiO1xuXG5jb25zdCBTRVJWSUNFU19LRVkgPSBcInJheWNhc3QtYWktc2VydmVyLXNlcnZpY2VzXCI7XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZWFkU2VydmljZXMoKTogUHJvbWlzZTxNYW5hZ2VkU2VydmljZVtdPiB7XG4gIGNvbnN0IHJhdyA9IGF3YWl0IExvY2FsU3RvcmFnZS5nZXRJdGVtPHN0cmluZz4oU0VSVklDRVNfS0VZKTtcbiAgaWYgKCFyYXcpIHJldHVybiBbXTtcbiAgdHJ5IHtcbiAgICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKHJhdykgYXMgTWFuYWdlZFNlcnZpY2VbXTtcbiAgICByZXR1cm4gQXJyYXkuaXNBcnJheShwYXJzZWQpID8gcGFyc2VkIDogW107XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBbXTtcbiAgfVxufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gd3JpdGVTZXJ2aWNlcyhzZXJ2aWNlczogTWFuYWdlZFNlcnZpY2VbXSk6IFByb21pc2U8dm9pZD4ge1xuICBhd2FpdCBMb2NhbFN0b3JhZ2Uuc2V0SXRlbShTRVJWSUNFU19LRVksIEpTT04uc3RyaW5naWZ5KHNlcnZpY2VzKSk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB1cHNlcnRTZXJ2aWNlKG5leHQ6IE1hbmFnZWRTZXJ2aWNlKTogUHJvbWlzZTx2b2lkPiB7XG4gIGNvbnN0IGN1cnJlbnQgPSBhd2FpdCByZWFkU2VydmljZXMoKTtcbiAgY29uc3QgaWR4ID0gY3VycmVudC5maW5kSW5kZXgoKHNlcnZpY2UpID0+IHNlcnZpY2UuaWQgPT09IG5leHQuaWQpO1xuICBpZiAoaWR4ID09PSAtMSkge1xuICAgIGN1cnJlbnQucHVzaChuZXh0KTtcbiAgfSBlbHNlIHtcbiAgICBjdXJyZW50W2lkeF0gPSBuZXh0O1xuICB9XG4gIGF3YWl0IHdyaXRlU2VydmljZXMoY3VycmVudCk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBwYXRjaFNlcnZpY2UoXG4gIGlkOiBzdHJpbmcsXG4gIHBhdGNoOiBQYXJ0aWFsPE1hbmFnZWRTZXJ2aWNlPixcbik6IFByb21pc2U8dm9pZD4ge1xuICBjb25zdCBjdXJyZW50ID0gYXdhaXQgcmVhZFNlcnZpY2VzKCk7XG4gIGNvbnN0IGlkeCA9IGN1cnJlbnQuZmluZEluZGV4KChzZXJ2aWNlKSA9PiBzZXJ2aWNlLmlkID09PSBpZCk7XG4gIGlmIChpZHggPT09IC0xKSByZXR1cm47XG4gIGN1cnJlbnRbaWR4XSA9IHsgLi4uY3VycmVudFtpZHhdLCAuLi5wYXRjaCB9O1xuICBhd2FpdCB3cml0ZVNlcnZpY2VzKGN1cnJlbnQpO1xufVxuIl0sCiAgIm1hcHBpbmdzIjogIjs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLElBQUFB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
