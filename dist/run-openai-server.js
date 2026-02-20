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

// src/run-openai-server.ts
var run_openai_server_exports = {};
__export(run_openai_server_exports, {
  default: () => Command
});
module.exports = __toCommonJS(run_openai_server_exports);
var import_api2 = require("@raycast/api");
var import_http = __toESM(require("http"));

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
async function patchService(id, patch) {
  const current = await readServices();
  const idx = current.findIndex((service) => service.id === id);
  if (idx === -1) return;
  current[idx] = { ...current[idx], ...patch };
  await writeServices(current);
}

// src/run-openai-server.ts
function isChatPath(pathname) {
  return pathname === "/v1/chat/completions" || pathname === "/chat/completions";
}
function isModelsPath(pathname) {
  return pathname === "/v1/models" || pathname === "/models";
}
function normalizeMessageContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const textParts = content.map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && "text" in item) {
        const text = item.text;
        return typeof text === "string" ? text : "";
      }
      return "";
    }).filter(Boolean);
    return textParts.join("\n");
  }
  if (content && typeof content === "object" && "text" in content) {
    const text = content.text;
    if (typeof text === "string") return text;
  }
  return "";
}
function buildPrompt(messages) {
  const lines = messages.map((message) => {
    const role = message.role || "user";
    const text = normalizeMessageContent(message.content);
    return `${role}: ${text}`.trim();
  }).filter(Boolean);
  if (lines.length === 0) return "";
  return `${lines.join("\n\n")}

assistant:`;
}
function openAIResponse(model, content) {
  return {
    id: `chatcmpl-raycast-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1e3),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop"
      }
    ]
  };
}
function openAIStreamChunk(model, contentDelta) {
  return {
    id: `chatcmpl-raycast-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1e3),
    model,
    choices: [
      {
        index: 0,
        delta: { content: contentDelta },
        finish_reason: null
      }
    ]
  };
}
function openAIStreamEnd(model) {
  return {
    id: `chatcmpl-raycast-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1e3),
    model,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: "stop"
      }
    ]
  };
}
async function Command(props) {
  const context = props.launchContext;
  if (!context) {
    await (0, import_api2.showToast)({
      style: import_api2.Toast.Style.Failure,
      title: "Missing Launch Context",
      message: "Please start server from Service Manager"
    });
    return;
  }
  const { serviceId, modelKey, modelValue, port } = context;
  const selectedModel = import_api2.AI.Model[modelKey] || modelValue;
  const server = import_http.default.createServer((req, res) => {
    const method = req.method || "GET";
    const pathname = req.url?.split("?")[0] || "/";
    if (method === "GET" && pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, model: modelValue, port }));
      return;
    }
    if (method === "POST" && pathname === "/kill") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ message: `Server on port ${port} is shutting down` })
      );
      server.close();
      return;
    }
    if (method === "GET" && isModelsPath(pathname)) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          object: "list",
          data: [
            {
              id: modelValue,
              object: "model",
              owned_by: "raycast"
            }
          ]
        })
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
        const payload = JSON.parse(body || "{}");
        if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "messages is required" }));
          return;
        }
        const requestModel = payload.model || modelValue;
        const prompt = buildPrompt(payload.messages);
        if (!prompt.trim()) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ error: "Could not parse messages content" })
          );
          return;
        }
        const stream = import_api2.AI.ask(prompt, { model: selectedModel });
        if (payload.stream) {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive"
          });
          stream.on("data", (chunk) => {
            const delta = chunk.toString();
            res.write(
              `data: ${JSON.stringify(openAIStreamChunk(requestModel, delta))}

`
            );
          });
          await stream;
          res.write(
            `data: ${JSON.stringify(openAIStreamEnd(requestModel))}

`
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
  server.on("error", async (error) => {
    await patchService(serviceId, {
      status: "error",
      lastError: error.message
    });
  });
  server.on("close", async () => {
    await patchService(serviceId, { status: "stopped" });
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, () => resolve());
    });
    await patchService(serviceId, {
      status: "running",
      modelKey,
      modelValue,
      port,
      lastError: void 0
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await patchService(serviceId, { status: "error", lastError: message });
    await (0, import_api2.showToast)({
      style: import_api2.Toast.Style.Failure,
      title: `Failed to start :${port}`,
      message
    });
    return;
  }
  await new Promise(() => void 0);
}
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3J1bi1vcGVuYWktc2VydmVyLnRzIiwgIi4uL3NyYy9zdG9yYWdlLnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJpbXBvcnQgeyBBSSwgTGF1bmNoUHJvcHMsIHNob3dUb2FzdCwgVG9hc3QgfSBmcm9tIFwiQHJheWNhc3QvYXBpXCI7XG5pbXBvcnQgaHR0cCBmcm9tIFwiaHR0cFwiO1xuaW1wb3J0IHsgcGF0Y2hTZXJ2aWNlIH0gZnJvbSBcIi4vc3RvcmFnZVwiO1xuaW1wb3J0IHR5cGUgeyBTZXJ2ZXJMYXVuY2hDb250ZXh0IH0gZnJvbSBcIi4vdHlwZXNcIjtcblxudHlwZSBDaGF0TWVzc2FnZSA9IHtcbiAgcm9sZTogc3RyaW5nO1xuICBjb250ZW50PzogdW5rbm93bjtcbn07XG5cbnR5cGUgQ2hhdENvbXBsZXRpb25zUmVxdWVzdCA9IHtcbiAgbW9kZWw/OiBzdHJpbmc7XG4gIHN0cmVhbT86IGJvb2xlYW47XG4gIG1lc3NhZ2VzPzogQ2hhdE1lc3NhZ2VbXTtcbn07XG5cbmZ1bmN0aW9uIGlzQ2hhdFBhdGgocGF0aG5hbWU6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gKFxuICAgIHBhdGhuYW1lID09PSBcIi92MS9jaGF0L2NvbXBsZXRpb25zXCIgfHwgcGF0aG5hbWUgPT09IFwiL2NoYXQvY29tcGxldGlvbnNcIlxuICApO1xufVxuXG5mdW5jdGlvbiBpc01vZGVsc1BhdGgocGF0aG5hbWU6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gcGF0aG5hbWUgPT09IFwiL3YxL21vZGVsc1wiIHx8IHBhdGhuYW1lID09PSBcIi9tb2RlbHNcIjtcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplTWVzc2FnZUNvbnRlbnQoY29udGVudDogdW5rbm93bik6IHN0cmluZyB7XG4gIGlmICh0eXBlb2YgY29udGVudCA9PT0gXCJzdHJpbmdcIikgcmV0dXJuIGNvbnRlbnQ7XG4gIGlmIChBcnJheS5pc0FycmF5KGNvbnRlbnQpKSB7XG4gICAgY29uc3QgdGV4dFBhcnRzID0gY29udGVudFxuICAgICAgLm1hcCgoaXRlbSkgPT4ge1xuICAgICAgICBpZiAodHlwZW9mIGl0ZW0gPT09IFwic3RyaW5nXCIpIHJldHVybiBpdGVtO1xuICAgICAgICBpZiAoaXRlbSAmJiB0eXBlb2YgaXRlbSA9PT0gXCJvYmplY3RcIiAmJiBcInRleHRcIiBpbiBpdGVtKSB7XG4gICAgICAgICAgY29uc3QgdGV4dCA9IChpdGVtIGFzIHsgdGV4dD86IHVua25vd24gfSkudGV4dDtcbiAgICAgICAgICByZXR1cm4gdHlwZW9mIHRleHQgPT09IFwic3RyaW5nXCIgPyB0ZXh0IDogXCJcIjtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gXCJcIjtcbiAgICAgIH0pXG4gICAgICAuZmlsdGVyKEJvb2xlYW4pO1xuICAgIHJldHVybiB0ZXh0UGFydHMuam9pbihcIlxcblwiKTtcbiAgfVxuICBpZiAoY29udGVudCAmJiB0eXBlb2YgY29udGVudCA9PT0gXCJvYmplY3RcIiAmJiBcInRleHRcIiBpbiBjb250ZW50KSB7XG4gICAgY29uc3QgdGV4dCA9IChjb250ZW50IGFzIHsgdGV4dD86IHVua25vd24gfSkudGV4dDtcbiAgICBpZiAodHlwZW9mIHRleHQgPT09IFwic3RyaW5nXCIpIHJldHVybiB0ZXh0O1xuICB9XG4gIHJldHVybiBcIlwiO1xufVxuXG5mdW5jdGlvbiBidWlsZFByb21wdChtZXNzYWdlczogQ2hhdE1lc3NhZ2VbXSk6IHN0cmluZyB7XG4gIGNvbnN0IGxpbmVzID0gbWVzc2FnZXNcbiAgICAubWFwKChtZXNzYWdlKSA9PiB7XG4gICAgICBjb25zdCByb2xlID0gbWVzc2FnZS5yb2xlIHx8IFwidXNlclwiO1xuICAgICAgY29uc3QgdGV4dCA9IG5vcm1hbGl6ZU1lc3NhZ2VDb250ZW50KG1lc3NhZ2UuY29udGVudCk7XG4gICAgICByZXR1cm4gYCR7cm9sZX06ICR7dGV4dH1gLnRyaW0oKTtcbiAgICB9KVxuICAgIC5maWx0ZXIoQm9vbGVhbik7XG5cbiAgaWYgKGxpbmVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFwiXCI7XG5cbiAgLy8gUHJlc2VydmUgbXVsdGktdHVybiBjb250ZXh0IHdoaWxlIGJpYXNpbmcgbGF0ZXN0IHVzZXIgcXVlc3Rpb24uXG4gIHJldHVybiBgJHtsaW5lcy5qb2luKFwiXFxuXFxuXCIpfVxcblxcbmFzc2lzdGFudDpgO1xufVxuXG5mdW5jdGlvbiBvcGVuQUlSZXNwb25zZShtb2RlbDogc3RyaW5nLCBjb250ZW50OiBzdHJpbmcpIHtcbiAgcmV0dXJuIHtcbiAgICBpZDogYGNoYXRjbXBsLXJheWNhc3QtJHtEYXRlLm5vdygpfWAsXG4gICAgb2JqZWN0OiBcImNoYXQuY29tcGxldGlvblwiLFxuICAgIGNyZWF0ZWQ6IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApLFxuICAgIG1vZGVsLFxuICAgIGNob2ljZXM6IFtcbiAgICAgIHtcbiAgICAgICAgaW5kZXg6IDAsXG4gICAgICAgIG1lc3NhZ2U6IHsgcm9sZTogXCJhc3Npc3RhbnRcIiwgY29udGVudCB9LFxuICAgICAgICBmaW5pc2hfcmVhc29uOiBcInN0b3BcIixcbiAgICAgIH0sXG4gICAgXSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gb3BlbkFJU3RyZWFtQ2h1bmsobW9kZWw6IHN0cmluZywgY29udGVudERlbHRhOiBzdHJpbmcpIHtcbiAgcmV0dXJuIHtcbiAgICBpZDogYGNoYXRjbXBsLXJheWNhc3QtJHtEYXRlLm5vdygpfWAsXG4gICAgb2JqZWN0OiBcImNoYXQuY29tcGxldGlvbi5jaHVua1wiLFxuICAgIGNyZWF0ZWQ6IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApLFxuICAgIG1vZGVsLFxuICAgIGNob2ljZXM6IFtcbiAgICAgIHtcbiAgICAgICAgaW5kZXg6IDAsXG4gICAgICAgIGRlbHRhOiB7IGNvbnRlbnQ6IGNvbnRlbnREZWx0YSB9LFxuICAgICAgICBmaW5pc2hfcmVhc29uOiBudWxsLFxuICAgICAgfSxcbiAgICBdLFxuICB9O1xufVxuXG5mdW5jdGlvbiBvcGVuQUlTdHJlYW1FbmQobW9kZWw6IHN0cmluZykge1xuICByZXR1cm4ge1xuICAgIGlkOiBgY2hhdGNtcGwtcmF5Y2FzdC0ke0RhdGUubm93KCl9YCxcbiAgICBvYmplY3Q6IFwiY2hhdC5jb21wbGV0aW9uLmNodW5rXCIsXG4gICAgY3JlYXRlZDogTWF0aC5mbG9vcihEYXRlLm5vdygpIC8gMTAwMCksXG4gICAgbW9kZWwsXG4gICAgY2hvaWNlczogW1xuICAgICAge1xuICAgICAgICBpbmRleDogMCxcbiAgICAgICAgZGVsdGE6IHt9LFxuICAgICAgICBmaW5pc2hfcmVhc29uOiBcInN0b3BcIixcbiAgICAgIH0sXG4gICAgXSxcbiAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgYXN5bmMgZnVuY3Rpb24gQ29tbWFuZChcbiAgcHJvcHM6IExhdW5jaFByb3BzPHsgbGF1bmNoQ29udGV4dD86IFNlcnZlckxhdW5jaENvbnRleHQgfT4sXG4pIHtcbiAgY29uc3QgY29udGV4dCA9IHByb3BzLmxhdW5jaENvbnRleHQ7XG4gIGlmICghY29udGV4dCkge1xuICAgIGF3YWl0IHNob3dUb2FzdCh7XG4gICAgICBzdHlsZTogVG9hc3QuU3R5bGUuRmFpbHVyZSxcbiAgICAgIHRpdGxlOiBcIk1pc3NpbmcgTGF1bmNoIENvbnRleHRcIixcbiAgICAgIG1lc3NhZ2U6IFwiUGxlYXNlIHN0YXJ0IHNlcnZlciBmcm9tIFNlcnZpY2UgTWFuYWdlclwiLFxuICAgIH0pO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGNvbnN0IHsgc2VydmljZUlkLCBtb2RlbEtleSwgbW9kZWxWYWx1ZSwgcG9ydCB9ID0gY29udGV4dDtcblxuICBjb25zdCBzZWxlY3RlZE1vZGVsID0gKEFJLk1vZGVsW21vZGVsS2V5IGFzIGtleW9mIHR5cGVvZiBBSS5Nb2RlbF0gfHxcbiAgICBtb2RlbFZhbHVlKSBhcyBBSS5Nb2RlbDtcblxuICBjb25zdCBzZXJ2ZXIgPSBodHRwLmNyZWF0ZVNlcnZlcigocmVxLCByZXMpID0+IHtcbiAgICBjb25zdCBtZXRob2QgPSByZXEubWV0aG9kIHx8IFwiR0VUXCI7XG4gICAgY29uc3QgcGF0aG5hbWUgPSByZXEudXJsPy5zcGxpdChcIj9cIilbMF0gfHwgXCIvXCI7XG5cbiAgICBpZiAobWV0aG9kID09PSBcIkdFVFwiICYmIHBhdGhuYW1lID09PSBcIi9oZWFsdGhcIikge1xuICAgICAgcmVzLndyaXRlSGVhZCgyMDAsIHsgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIgfSk7XG4gICAgICByZXMuZW5kKEpTT04uc3RyaW5naWZ5KHsgb2s6IHRydWUsIG1vZGVsOiBtb2RlbFZhbHVlLCBwb3J0IH0pKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAobWV0aG9kID09PSBcIlBPU1RcIiAmJiBwYXRobmFtZSA9PT0gXCIva2lsbFwiKSB7XG4gICAgICByZXMud3JpdGVIZWFkKDIwMCwgeyBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIiB9KTtcbiAgICAgIHJlcy5lbmQoXG4gICAgICAgIEpTT04uc3RyaW5naWZ5KHsgbWVzc2FnZTogYFNlcnZlciBvbiBwb3J0ICR7cG9ydH0gaXMgc2h1dHRpbmcgZG93bmAgfSksXG4gICAgICApO1xuICAgICAgc2VydmVyLmNsb3NlKCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKG1ldGhvZCA9PT0gXCJHRVRcIiAmJiBpc01vZGVsc1BhdGgocGF0aG5hbWUpKSB7XG4gICAgICByZXMud3JpdGVIZWFkKDIwMCwgeyBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIiB9KTtcbiAgICAgIHJlcy5lbmQoXG4gICAgICAgIEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICBvYmplY3Q6IFwibGlzdFwiLFxuICAgICAgICAgIGRhdGE6IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgaWQ6IG1vZGVsVmFsdWUsXG4gICAgICAgICAgICAgIG9iamVjdDogXCJtb2RlbFwiLFxuICAgICAgICAgICAgICBvd25lZF9ieTogXCJyYXljYXN0XCIsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIF0sXG4gICAgICAgIH0pLFxuICAgICAgKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAobWV0aG9kICE9PSBcIlBPU1RcIiB8fCAhaXNDaGF0UGF0aChwYXRobmFtZSkpIHtcbiAgICAgIHJlcy53cml0ZUhlYWQoNDA0LCB7IFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiIH0pO1xuICAgICAgcmVzLmVuZChKU09OLnN0cmluZ2lmeSh7IGVycm9yOiBcIkVuZHBvaW50IG5vdCBmb3VuZFwiIH0pKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBsZXQgYm9keSA9IFwiXCI7XG4gICAgcmVxLm9uKFwiZGF0YVwiLCAoY2h1bmspID0+IHtcbiAgICAgIGJvZHkgKz0gY2h1bms7XG4gICAgfSk7XG5cbiAgICByZXEub24oXCJlbmRcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcGF5bG9hZCA9IEpTT04ucGFyc2UoYm9keSB8fCBcInt9XCIpIGFzIENoYXRDb21wbGV0aW9uc1JlcXVlc3Q7XG5cbiAgICAgICAgaWYgKCFBcnJheS5pc0FycmF5KHBheWxvYWQubWVzc2FnZXMpIHx8IHBheWxvYWQubWVzc2FnZXMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgcmVzLndyaXRlSGVhZCg0MDAsIHsgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIgfSk7XG4gICAgICAgICAgcmVzLmVuZChKU09OLnN0cmluZ2lmeSh7IGVycm9yOiBcIm1lc3NhZ2VzIGlzIHJlcXVpcmVkXCIgfSkpO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHJlcXVlc3RNb2RlbCA9IHBheWxvYWQubW9kZWwgfHwgbW9kZWxWYWx1ZTtcbiAgICAgICAgY29uc3QgcHJvbXB0ID0gYnVpbGRQcm9tcHQocGF5bG9hZC5tZXNzYWdlcyk7XG4gICAgICAgIGlmICghcHJvbXB0LnRyaW0oKSkge1xuICAgICAgICAgIHJlcy53cml0ZUhlYWQoNDAwLCB7IFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiIH0pO1xuICAgICAgICAgIHJlcy5lbmQoXG4gICAgICAgICAgICBKU09OLnN0cmluZ2lmeSh7IGVycm9yOiBcIkNvdWxkIG5vdCBwYXJzZSBtZXNzYWdlcyBjb250ZW50XCIgfSksXG4gICAgICAgICAgKTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBzdHJlYW0gPSBBSS5hc2socHJvbXB0LCB7IG1vZGVsOiBzZWxlY3RlZE1vZGVsIH0pO1xuXG4gICAgICAgIGlmIChwYXlsb2FkLnN0cmVhbSkge1xuICAgICAgICAgIHJlcy53cml0ZUhlYWQoMjAwLCB7XG4gICAgICAgICAgICBcIkNvbnRlbnQtVHlwZVwiOiBcInRleHQvZXZlbnQtc3RyZWFtXCIsXG4gICAgICAgICAgICBcIkNhY2hlLUNvbnRyb2xcIjogXCJuby1jYWNoZVwiLFxuICAgICAgICAgICAgQ29ubmVjdGlvbjogXCJrZWVwLWFsaXZlXCIsXG4gICAgICAgICAgfSk7XG5cbiAgICAgICAgICBzdHJlYW0ub24oXCJkYXRhXCIsIChjaHVuaykgPT4ge1xuICAgICAgICAgICAgY29uc3QgZGVsdGEgPSBjaHVuay50b1N0cmluZygpO1xuICAgICAgICAgICAgcmVzLndyaXRlKFxuICAgICAgICAgICAgICBgZGF0YTogJHtKU09OLnN0cmluZ2lmeShvcGVuQUlTdHJlYW1DaHVuayhyZXF1ZXN0TW9kZWwsIGRlbHRhKSl9XFxuXFxuYCxcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfSk7XG5cbiAgICAgICAgICBhd2FpdCBzdHJlYW07XG4gICAgICAgICAgcmVzLndyaXRlKFxuICAgICAgICAgICAgYGRhdGE6ICR7SlNPTi5zdHJpbmdpZnkob3BlbkFJU3RyZWFtRW5kKHJlcXVlc3RNb2RlbCkpfVxcblxcbmAsXG4gICAgICAgICAgKTtcbiAgICAgICAgICByZXMud3JpdGUoXCJkYXRhOiBbRE9ORV1cXG5cXG5cIik7XG4gICAgICAgICAgcmVzLmVuZCgpO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGFuc3dlciA9IGF3YWl0IHN0cmVhbTtcbiAgICAgICAgcmVzLndyaXRlSGVhZCgyMDAsIHsgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIgfSk7XG4gICAgICAgIHJlcy5lbmQoSlNPTi5zdHJpbmdpZnkob3BlbkFJUmVzcG9uc2UocmVxdWVzdE1vZGVsLCBhbnN3ZXIpKSk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zdCBtZXNzYWdlID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpO1xuICAgICAgICByZXMud3JpdGVIZWFkKDUwMCwgeyBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIiB9KTtcbiAgICAgICAgcmVzLmVuZChKU09OLnN0cmluZ2lmeSh7IGVycm9yOiBtZXNzYWdlIH0pKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfSk7XG5cbiAgc2VydmVyLm9uKFwiZXJyb3JcIiwgYXN5bmMgKGVycm9yOiBFcnJvcikgPT4ge1xuICAgIGF3YWl0IHBhdGNoU2VydmljZShzZXJ2aWNlSWQsIHtcbiAgICAgIHN0YXR1czogXCJlcnJvclwiLFxuICAgICAgbGFzdEVycm9yOiBlcnJvci5tZXNzYWdlLFxuICAgIH0pO1xuICB9KTtcblxuICBzZXJ2ZXIub24oXCJjbG9zZVwiLCBhc3luYyAoKSA9PiB7XG4gICAgYXdhaXQgcGF0Y2hTZXJ2aWNlKHNlcnZpY2VJZCwgeyBzdGF0dXM6IFwic3RvcHBlZFwiIH0pO1xuICB9KTtcblxuICB0cnkge1xuICAgIGF3YWl0IG5ldyBQcm9taXNlPHZvaWQ+KChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIHNlcnZlci5vbmNlKFwiZXJyb3JcIiwgcmVqZWN0KTtcbiAgICAgIHNlcnZlci5saXN0ZW4ocG9ydCwgKCkgPT4gcmVzb2x2ZSgpKTtcbiAgICB9KTtcblxuICAgIGF3YWl0IHBhdGNoU2VydmljZShzZXJ2aWNlSWQsIHtcbiAgICAgIHN0YXR1czogXCJydW5uaW5nXCIsXG4gICAgICBtb2RlbEtleSxcbiAgICAgIG1vZGVsVmFsdWUsXG4gICAgICBwb3J0LFxuICAgICAgbGFzdEVycm9yOiB1bmRlZmluZWQsXG4gICAgfSk7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgY29uc3QgbWVzc2FnZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKTtcbiAgICBhd2FpdCBwYXRjaFNlcnZpY2Uoc2VydmljZUlkLCB7IHN0YXR1czogXCJlcnJvclwiLCBsYXN0RXJyb3I6IG1lc3NhZ2UgfSk7XG4gICAgYXdhaXQgc2hvd1RvYXN0KHtcbiAgICAgIHN0eWxlOiBUb2FzdC5TdHlsZS5GYWlsdXJlLFxuICAgICAgdGl0bGU6IGBGYWlsZWQgdG8gc3RhcnQgOiR7cG9ydH1gLFxuICAgICAgbWVzc2FnZSxcbiAgICB9KTtcbiAgICByZXR1cm47XG4gIH1cblxuICBhd2FpdCBuZXcgUHJvbWlzZSgoKSA9PiB1bmRlZmluZWQpO1xufVxuIiwgImltcG9ydCB7IExvY2FsU3RvcmFnZSB9IGZyb20gXCJAcmF5Y2FzdC9hcGlcIjtcbmltcG9ydCB0eXBlIHsgTWFuYWdlZFNlcnZpY2UgfSBmcm9tIFwiLi90eXBlc1wiO1xuXG5jb25zdCBTRVJWSUNFU19LRVkgPSBcInJheWNhc3QtYWktc2VydmVyLXNlcnZpY2VzXCI7XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZWFkU2VydmljZXMoKTogUHJvbWlzZTxNYW5hZ2VkU2VydmljZVtdPiB7XG4gIGNvbnN0IHJhdyA9IGF3YWl0IExvY2FsU3RvcmFnZS5nZXRJdGVtPHN0cmluZz4oU0VSVklDRVNfS0VZKTtcbiAgaWYgKCFyYXcpIHJldHVybiBbXTtcbiAgdHJ5IHtcbiAgICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKHJhdykgYXMgTWFuYWdlZFNlcnZpY2VbXTtcbiAgICByZXR1cm4gQXJyYXkuaXNBcnJheShwYXJzZWQpID8gcGFyc2VkIDogW107XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBbXTtcbiAgfVxufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gd3JpdGVTZXJ2aWNlcyhzZXJ2aWNlczogTWFuYWdlZFNlcnZpY2VbXSk6IFByb21pc2U8dm9pZD4ge1xuICBhd2FpdCBMb2NhbFN0b3JhZ2Uuc2V0SXRlbShTRVJWSUNFU19LRVksIEpTT04uc3RyaW5naWZ5KHNlcnZpY2VzKSk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB1cHNlcnRTZXJ2aWNlKG5leHQ6IE1hbmFnZWRTZXJ2aWNlKTogUHJvbWlzZTx2b2lkPiB7XG4gIGNvbnN0IGN1cnJlbnQgPSBhd2FpdCByZWFkU2VydmljZXMoKTtcbiAgY29uc3QgaWR4ID0gY3VycmVudC5maW5kSW5kZXgoKHNlcnZpY2UpID0+IHNlcnZpY2UuaWQgPT09IG5leHQuaWQpO1xuICBpZiAoaWR4ID09PSAtMSkge1xuICAgIGN1cnJlbnQucHVzaChuZXh0KTtcbiAgfSBlbHNlIHtcbiAgICBjdXJyZW50W2lkeF0gPSBuZXh0O1xuICB9XG4gIGF3YWl0IHdyaXRlU2VydmljZXMoY3VycmVudCk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBwYXRjaFNlcnZpY2UoXG4gIGlkOiBzdHJpbmcsXG4gIHBhdGNoOiBQYXJ0aWFsPE1hbmFnZWRTZXJ2aWNlPixcbik6IFByb21pc2U8dm9pZD4ge1xuICBjb25zdCBjdXJyZW50ID0gYXdhaXQgcmVhZFNlcnZpY2VzKCk7XG4gIGNvbnN0IGlkeCA9IGN1cnJlbnQuZmluZEluZGV4KChzZXJ2aWNlKSA9PiBzZXJ2aWNlLmlkID09PSBpZCk7XG4gIGlmIChpZHggPT09IC0xKSByZXR1cm47XG4gIGN1cnJlbnRbaWR4XSA9IHsgLi4uY3VycmVudFtpZHhdLCAuLi5wYXRjaCB9O1xuICBhd2FpdCB3cml0ZVNlcnZpY2VzKGN1cnJlbnQpO1xufVxuIl0sCiAgIm1hcHBpbmdzIjogIjs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLElBQUFBLGNBQWtEO0FBQ2xELGtCQUFpQjs7O0FDRGpCLGlCQUE2QjtBQUc3QixJQUFNLGVBQWU7QUFFckIsZUFBc0IsZUFBMEM7QUFDOUQsUUFBTSxNQUFNLE1BQU0sd0JBQWEsUUFBZ0IsWUFBWTtBQUMzRCxNQUFJLENBQUMsSUFBSyxRQUFPLENBQUM7QUFDbEIsTUFBSTtBQUNGLFVBQU0sU0FBUyxLQUFLLE1BQU0sR0FBRztBQUM3QixXQUFPLE1BQU0sUUFBUSxNQUFNLElBQUksU0FBUyxDQUFDO0FBQUEsRUFDM0MsUUFBUTtBQUNOLFdBQU8sQ0FBQztBQUFBLEVBQ1Y7QUFDRjtBQUVBLGVBQXNCLGNBQWMsVUFBMkM7QUFDN0UsUUFBTSx3QkFBYSxRQUFRLGNBQWMsS0FBSyxVQUFVLFFBQVEsQ0FBQztBQUNuRTtBQWFBLGVBQXNCLGFBQ3BCLElBQ0EsT0FDZTtBQUNmLFFBQU0sVUFBVSxNQUFNLGFBQWE7QUFDbkMsUUFBTSxNQUFNLFFBQVEsVUFBVSxDQUFDLFlBQVksUUFBUSxPQUFPLEVBQUU7QUFDNUQsTUFBSSxRQUFRLEdBQUk7QUFDaEIsVUFBUSxHQUFHLElBQUksRUFBRSxHQUFHLFFBQVEsR0FBRyxHQUFHLEdBQUcsTUFBTTtBQUMzQyxRQUFNLGNBQWMsT0FBTztBQUM3Qjs7O0FEeEJBLFNBQVMsV0FBVyxVQUEyQjtBQUM3QyxTQUNFLGFBQWEsMEJBQTBCLGFBQWE7QUFFeEQ7QUFFQSxTQUFTLGFBQWEsVUFBMkI7QUFDL0MsU0FBTyxhQUFhLGdCQUFnQixhQUFhO0FBQ25EO0FBRUEsU0FBUyx3QkFBd0IsU0FBMEI7QUFDekQsTUFBSSxPQUFPLFlBQVksU0FBVSxRQUFPO0FBQ3hDLE1BQUksTUFBTSxRQUFRLE9BQU8sR0FBRztBQUMxQixVQUFNLFlBQVksUUFDZixJQUFJLENBQUMsU0FBUztBQUNiLFVBQUksT0FBTyxTQUFTLFNBQVUsUUFBTztBQUNyQyxVQUFJLFFBQVEsT0FBTyxTQUFTLFlBQVksVUFBVSxNQUFNO0FBQ3RELGNBQU0sT0FBUSxLQUE0QjtBQUMxQyxlQUFPLE9BQU8sU0FBUyxXQUFXLE9BQU87QUFBQSxNQUMzQztBQUNBLGFBQU87QUFBQSxJQUNULENBQUMsRUFDQSxPQUFPLE9BQU87QUFDakIsV0FBTyxVQUFVLEtBQUssSUFBSTtBQUFBLEVBQzVCO0FBQ0EsTUFBSSxXQUFXLE9BQU8sWUFBWSxZQUFZLFVBQVUsU0FBUztBQUMvRCxVQUFNLE9BQVEsUUFBK0I7QUFDN0MsUUFBSSxPQUFPLFNBQVMsU0FBVSxRQUFPO0FBQUEsRUFDdkM7QUFDQSxTQUFPO0FBQ1Q7QUFFQSxTQUFTLFlBQVksVUFBaUM7QUFDcEQsUUFBTSxRQUFRLFNBQ1gsSUFBSSxDQUFDLFlBQVk7QUFDaEIsVUFBTSxPQUFPLFFBQVEsUUFBUTtBQUM3QixVQUFNLE9BQU8sd0JBQXdCLFFBQVEsT0FBTztBQUNwRCxXQUFPLEdBQUcsSUFBSSxLQUFLLElBQUksR0FBRyxLQUFLO0FBQUEsRUFDakMsQ0FBQyxFQUNBLE9BQU8sT0FBTztBQUVqQixNQUFJLE1BQU0sV0FBVyxFQUFHLFFBQU87QUFHL0IsU0FBTyxHQUFHLE1BQU0sS0FBSyxNQUFNLENBQUM7QUFBQTtBQUFBO0FBQzlCO0FBRUEsU0FBUyxlQUFlLE9BQWUsU0FBaUI7QUFDdEQsU0FBTztBQUFBLElBQ0wsSUFBSSxvQkFBb0IsS0FBSyxJQUFJLENBQUM7QUFBQSxJQUNsQyxRQUFRO0FBQUEsSUFDUixTQUFTLEtBQUssTUFBTSxLQUFLLElBQUksSUFBSSxHQUFJO0FBQUEsSUFDckM7QUFBQSxJQUNBLFNBQVM7QUFBQSxNQUNQO0FBQUEsUUFDRSxPQUFPO0FBQUEsUUFDUCxTQUFTLEVBQUUsTUFBTSxhQUFhLFFBQVE7QUFBQSxRQUN0QyxlQUFlO0FBQUEsTUFDakI7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUNGO0FBRUEsU0FBUyxrQkFBa0IsT0FBZSxjQUFzQjtBQUM5RCxTQUFPO0FBQUEsSUFDTCxJQUFJLG9CQUFvQixLQUFLLElBQUksQ0FBQztBQUFBLElBQ2xDLFFBQVE7QUFBQSxJQUNSLFNBQVMsS0FBSyxNQUFNLEtBQUssSUFBSSxJQUFJLEdBQUk7QUFBQSxJQUNyQztBQUFBLElBQ0EsU0FBUztBQUFBLE1BQ1A7QUFBQSxRQUNFLE9BQU87QUFBQSxRQUNQLE9BQU8sRUFBRSxTQUFTLGFBQWE7QUFBQSxRQUMvQixlQUFlO0FBQUEsTUFDakI7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUNGO0FBRUEsU0FBUyxnQkFBZ0IsT0FBZTtBQUN0QyxTQUFPO0FBQUEsSUFDTCxJQUFJLG9CQUFvQixLQUFLLElBQUksQ0FBQztBQUFBLElBQ2xDLFFBQVE7QUFBQSxJQUNSLFNBQVMsS0FBSyxNQUFNLEtBQUssSUFBSSxJQUFJLEdBQUk7QUFBQSxJQUNyQztBQUFBLElBQ0EsU0FBUztBQUFBLE1BQ1A7QUFBQSxRQUNFLE9BQU87QUFBQSxRQUNQLE9BQU8sQ0FBQztBQUFBLFFBQ1IsZUFBZTtBQUFBLE1BQ2pCO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFDRjtBQUVBLGVBQU8sUUFDTCxPQUNBO0FBQ0EsUUFBTSxVQUFVLE1BQU07QUFDdEIsTUFBSSxDQUFDLFNBQVM7QUFDWixjQUFNLHVCQUFVO0FBQUEsTUFDZCxPQUFPLGtCQUFNLE1BQU07QUFBQSxNQUNuQixPQUFPO0FBQUEsTUFDUCxTQUFTO0FBQUEsSUFDWCxDQUFDO0FBQ0Q7QUFBQSxFQUNGO0FBRUEsUUFBTSxFQUFFLFdBQVcsVUFBVSxZQUFZLEtBQUssSUFBSTtBQUVsRCxRQUFNLGdCQUFpQixlQUFHLE1BQU0sUUFBaUMsS0FDL0Q7QUFFRixRQUFNLFNBQVMsWUFBQUMsUUFBSyxhQUFhLENBQUMsS0FBSyxRQUFRO0FBQzdDLFVBQU0sU0FBUyxJQUFJLFVBQVU7QUFDN0IsVUFBTSxXQUFXLElBQUksS0FBSyxNQUFNLEdBQUcsRUFBRSxDQUFDLEtBQUs7QUFFM0MsUUFBSSxXQUFXLFNBQVMsYUFBYSxXQUFXO0FBQzlDLFVBQUksVUFBVSxLQUFLLEVBQUUsZ0JBQWdCLG1CQUFtQixDQUFDO0FBQ3pELFVBQUksSUFBSSxLQUFLLFVBQVUsRUFBRSxJQUFJLE1BQU0sT0FBTyxZQUFZLEtBQUssQ0FBQyxDQUFDO0FBQzdEO0FBQUEsSUFDRjtBQUVBLFFBQUksV0FBVyxVQUFVLGFBQWEsU0FBUztBQUM3QyxVQUFJLFVBQVUsS0FBSyxFQUFFLGdCQUFnQixtQkFBbUIsQ0FBQztBQUN6RCxVQUFJO0FBQUEsUUFDRixLQUFLLFVBQVUsRUFBRSxTQUFTLGtCQUFrQixJQUFJLG9CQUFvQixDQUFDO0FBQUEsTUFDdkU7QUFDQSxhQUFPLE1BQU07QUFDYjtBQUFBLElBQ0Y7QUFFQSxRQUFJLFdBQVcsU0FBUyxhQUFhLFFBQVEsR0FBRztBQUM5QyxVQUFJLFVBQVUsS0FBSyxFQUFFLGdCQUFnQixtQkFBbUIsQ0FBQztBQUN6RCxVQUFJO0FBQUEsUUFDRixLQUFLLFVBQVU7QUFBQSxVQUNiLFFBQVE7QUFBQSxVQUNSLE1BQU07QUFBQSxZQUNKO0FBQUEsY0FDRSxJQUFJO0FBQUEsY0FDSixRQUFRO0FBQUEsY0FDUixVQUFVO0FBQUEsWUFDWjtBQUFBLFVBQ0Y7QUFBQSxRQUNGLENBQUM7QUFBQSxNQUNIO0FBQ0E7QUFBQSxJQUNGO0FBRUEsUUFBSSxXQUFXLFVBQVUsQ0FBQyxXQUFXLFFBQVEsR0FBRztBQUM5QyxVQUFJLFVBQVUsS0FBSyxFQUFFLGdCQUFnQixtQkFBbUIsQ0FBQztBQUN6RCxVQUFJLElBQUksS0FBSyxVQUFVLEVBQUUsT0FBTyxxQkFBcUIsQ0FBQyxDQUFDO0FBQ3ZEO0FBQUEsSUFDRjtBQUVBLFFBQUksT0FBTztBQUNYLFFBQUksR0FBRyxRQUFRLENBQUMsVUFBVTtBQUN4QixjQUFRO0FBQUEsSUFDVixDQUFDO0FBRUQsUUFBSSxHQUFHLE9BQU8sWUFBWTtBQUN4QixVQUFJO0FBQ0YsY0FBTSxVQUFVLEtBQUssTUFBTSxRQUFRLElBQUk7QUFFdkMsWUFBSSxDQUFDLE1BQU0sUUFBUSxRQUFRLFFBQVEsS0FBSyxRQUFRLFNBQVMsV0FBVyxHQUFHO0FBQ3JFLGNBQUksVUFBVSxLQUFLLEVBQUUsZ0JBQWdCLG1CQUFtQixDQUFDO0FBQ3pELGNBQUksSUFBSSxLQUFLLFVBQVUsRUFBRSxPQUFPLHVCQUF1QixDQUFDLENBQUM7QUFDekQ7QUFBQSxRQUNGO0FBRUEsY0FBTSxlQUFlLFFBQVEsU0FBUztBQUN0QyxjQUFNLFNBQVMsWUFBWSxRQUFRLFFBQVE7QUFDM0MsWUFBSSxDQUFDLE9BQU8sS0FBSyxHQUFHO0FBQ2xCLGNBQUksVUFBVSxLQUFLLEVBQUUsZ0JBQWdCLG1CQUFtQixDQUFDO0FBQ3pELGNBQUk7QUFBQSxZQUNGLEtBQUssVUFBVSxFQUFFLE9BQU8sbUNBQW1DLENBQUM7QUFBQSxVQUM5RDtBQUNBO0FBQUEsUUFDRjtBQUVBLGNBQU0sU0FBUyxlQUFHLElBQUksUUFBUSxFQUFFLE9BQU8sY0FBYyxDQUFDO0FBRXRELFlBQUksUUFBUSxRQUFRO0FBQ2xCLGNBQUksVUFBVSxLQUFLO0FBQUEsWUFDakIsZ0JBQWdCO0FBQUEsWUFDaEIsaUJBQWlCO0FBQUEsWUFDakIsWUFBWTtBQUFBLFVBQ2QsQ0FBQztBQUVELGlCQUFPLEdBQUcsUUFBUSxDQUFDLFVBQVU7QUFDM0Isa0JBQU0sUUFBUSxNQUFNLFNBQVM7QUFDN0IsZ0JBQUk7QUFBQSxjQUNGLFNBQVMsS0FBSyxVQUFVLGtCQUFrQixjQUFjLEtBQUssQ0FBQyxDQUFDO0FBQUE7QUFBQTtBQUFBLFlBQ2pFO0FBQUEsVUFDRixDQUFDO0FBRUQsZ0JBQU07QUFDTixjQUFJO0FBQUEsWUFDRixTQUFTLEtBQUssVUFBVSxnQkFBZ0IsWUFBWSxDQUFDLENBQUM7QUFBQTtBQUFBO0FBQUEsVUFDeEQ7QUFDQSxjQUFJLE1BQU0sa0JBQWtCO0FBQzVCLGNBQUksSUFBSTtBQUNSO0FBQUEsUUFDRjtBQUVBLGNBQU0sU0FBUyxNQUFNO0FBQ3JCLFlBQUksVUFBVSxLQUFLLEVBQUUsZ0JBQWdCLG1CQUFtQixDQUFDO0FBQ3pELFlBQUksSUFBSSxLQUFLLFVBQVUsZUFBZSxjQUFjLE1BQU0sQ0FBQyxDQUFDO0FBQUEsTUFDOUQsU0FBUyxPQUFPO0FBQ2QsY0FBTSxVQUFVLGlCQUFpQixRQUFRLE1BQU0sVUFBVSxPQUFPLEtBQUs7QUFDckUsWUFBSSxVQUFVLEtBQUssRUFBRSxnQkFBZ0IsbUJBQW1CLENBQUM7QUFDekQsWUFBSSxJQUFJLEtBQUssVUFBVSxFQUFFLE9BQU8sUUFBUSxDQUFDLENBQUM7QUFBQSxNQUM1QztBQUFBLElBQ0YsQ0FBQztBQUFBLEVBQ0gsQ0FBQztBQUVELFNBQU8sR0FBRyxTQUFTLE9BQU8sVUFBaUI7QUFDekMsVUFBTSxhQUFhLFdBQVc7QUFBQSxNQUM1QixRQUFRO0FBQUEsTUFDUixXQUFXLE1BQU07QUFBQSxJQUNuQixDQUFDO0FBQUEsRUFDSCxDQUFDO0FBRUQsU0FBTyxHQUFHLFNBQVMsWUFBWTtBQUM3QixVQUFNLGFBQWEsV0FBVyxFQUFFLFFBQVEsVUFBVSxDQUFDO0FBQUEsRUFDckQsQ0FBQztBQUVELE1BQUk7QUFDRixVQUFNLElBQUksUUFBYyxDQUFDLFNBQVMsV0FBVztBQUMzQyxhQUFPLEtBQUssU0FBUyxNQUFNO0FBQzNCLGFBQU8sT0FBTyxNQUFNLE1BQU0sUUFBUSxDQUFDO0FBQUEsSUFDckMsQ0FBQztBQUVELFVBQU0sYUFBYSxXQUFXO0FBQUEsTUFDNUIsUUFBUTtBQUFBLE1BQ1I7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0EsV0FBVztBQUFBLElBQ2IsQ0FBQztBQUFBLEVBQ0gsU0FBUyxPQUFPO0FBQ2QsVUFBTSxVQUFVLGlCQUFpQixRQUFRLE1BQU0sVUFBVSxPQUFPLEtBQUs7QUFDckUsVUFBTSxhQUFhLFdBQVcsRUFBRSxRQUFRLFNBQVMsV0FBVyxRQUFRLENBQUM7QUFDckUsY0FBTSx1QkFBVTtBQUFBLE1BQ2QsT0FBTyxrQkFBTSxNQUFNO0FBQUEsTUFDbkIsT0FBTyxvQkFBb0IsSUFBSTtBQUFBLE1BQy9CO0FBQUEsSUFDRixDQUFDO0FBQ0Q7QUFBQSxFQUNGO0FBRUEsUUFBTSxJQUFJLFFBQVEsTUFBTSxNQUFTO0FBQ25DOyIsCiAgIm5hbWVzIjogWyJpbXBvcnRfYXBpIiwgImh0dHAiXQp9Cg==
