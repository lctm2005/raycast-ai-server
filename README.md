# Raycast AI Server

把 Raycast AI 模型桥接成本地 OpenAI 兼容接口，供 OpenClaw 等客户端直接调用。

## 你能做什么

- 在 Raycast UI 中选择模型 + 端口启动服务
- 同时运行多个服务（不同端口/模型）
- 用 OpenAI 标准接口访问：`/v1/chat/completions`

## 使用步骤

1. 在 Raycast 打开 `Manage AI Server`
2. 选择模型（例如 `Perplexity Sonar Pro`）
3. 设置端口（例如 `1235`）
4. 点击 `Start Service`
5. 在服务列表确认状态为 `running`

## 给 OpenClaw 的配置

- Base URL: `http://127.0.0.1:<你的端口>/v1`
- API Key: 可填任意字符串（本插件不校验）
- Model: 使用你启动时对应的模型名（或沿用客户端默认值）

示例（端口 `1235`）：

- Base URL: `http://127.0.0.1:1235/v1`

## 可用接口

每个已启动端口都提供：

- `POST /v1/chat/completions`
- `POST /chat/completions`
- `GET /v1/models`
- `GET /models`
- `GET /health`
- `POST /kill`

## 快速验证

```bash
curl -X POST http://127.0.0.1:1235/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "perplexity-sonar-pro",
    "messages": [
      {"role": "user", "content": "Hello"}
    ]
  }'
```

## 日常管理

- 停止服务：在 `Manage AI Server` 里选中服务并执行 `Stop Service`
- 重启服务：先停再启（同端口同模型不会重复创建记录）
- 刷新状态：执行 `Refresh`

## 常见问题

- 服务启动后自动退出：
  使用 `Manage AI Server` 启动，不要手动运行内部命令。

- 端口冲突：
  换一个未占用端口，或停止占用该端口的服务。
