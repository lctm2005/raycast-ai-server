# Raycast AI Server

基于 Raycast AI 模型提供本地 OpenAI 兼容接口，供 OpenClaw 等本地客户端调用。

## 功能

- 在插件界面中选择模型与端口启动服务
- 管理已创建服务（刷新状态、停止、重启）
- OpenAI 兼容接口：
  - `POST /v1/chat/completions`
  - `POST /chat/completions`
  - `GET /v1/models`
  - `GET /models`
  - `GET /health`
  - `POST /kill`

## 开发

```bash
npm install
npm run dev
```

## 调用示例

```bash
curl -X POST http://127.0.0.1:1235/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "perplexity-sonar-pro",
    "messages": [
      {"role": "user", "content": "你好，给我一句话介绍 OpenClaw"}
    ]
  }'
```

```bash
curl -N -X POST http://127.0.0.1:1235/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "perplexity-sonar-pro",
    "stream": true,
    "messages": [
      {"role": "user", "content": "给我三条本地部署建议"}
    ]
  }'
```
