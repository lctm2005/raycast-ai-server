# Testing Guide

本文说明仓库内自动化测试脚本的作用与使用方式。

## 测试组成

1. `npm run typecheck`
作用：TypeScript 编译检查（不启动服务，不测运行时行为）。

2. `npm run test:smoke`
作用：多服务管理冒烟测试，覆盖启动/停止隔离、幂等启动、端口冲突。

3. `npm run test:tools`
作用：OpenAI Compatible 的工具调用行为测试，验证 `tool_calls` 返回结构。

4. `npm run test:model-id`
作用：探测某个或一批 `model id` 是否可用（以 `/v1/chat/completions` 返回 `200` 为准）。

## 前置条件

1. 先保证 admin daemon 在运行（默认 `127.0.0.1:46321`）。
2. 最稳妥方式：在 Raycast 里打开 `Manage AI Server` 并先启动过至少一个服务。
3. 或在本地开发环境运行 `npm run dev`，确保 `/admin/health` 可访问。
4. 本机可用 `bash`、`curl`、`python3`；`jq` 可选（仅用于更好看的 JSON 输出）。

## 快速开始

```bash
npm run typecheck
npm run test:smoke
npm run test:tools
```

## 各脚本详解

## 1) `test:smoke`

执行命令：

```bash
npm run test:smoke
```

默认行为：

1. 在三个端口启动三个服务（默认 `1235/1236/1237`）。
2. 验证三个服务都健康。
3. 停止中间一个服务，验证其余服务不受影响。
4. 验证同 `serviceId+port` 重复启动幂等。
5. 验证不同服务抢占同端口会返回 `409`。

可配置环境变量示例：

```bash
PORT_A=2235 PORT_B=2236 PORT_C=2237 npm run test:smoke
```

## 2) `test:tools`

执行命令：

```bash
npm run test:tools
```

默认行为：

1. 优先复用已运行服务；若无则在默认端口创建专用服务。
2. 发送带 `tools`/`tool_choice` 的请求到 `/v1/chat/completions`。
3. 断言返回中函数名、参数、`finish_reason=tool_calls`。

可配置环境变量示例：

```bash
PORT=1242 MODEL_KEY=anthropic-claude-sonnet-4-5 MODEL_VALUE=anthropic-claude-sonnet-4-5 npm run test:tools
```

关于 `SKIP`：

1. 若上游返回非 200（如配额限制或上游错误），脚本会打印 `[SKIP]` 并跳过该断言。
2. 这表示环境限制，不一定是本项目逻辑错误。

## 3) `test:model-id`

执行命令（单个 model id）：

```bash
MODEL_ID=anthropic-claude-sonnet-4-5 npm run test:model-id
```

执行命令（批量文件）：

```bash
CANDIDATES_FILE=./candidates.txt npm run test:model-id
```

执行命令（按模型名推断候选）：

```bash
MODEL_NAME="gpt 5" MAX_CANDIDATES=30 npm run test:model-id
```

默认行为：

1. 对每个候选 `model id` 启动服务并探测 `/v1/chat/completions`。
2. 返回 `200` 记为 `VALID`，否则输出 `INVALID + HTTP 状态码 + 截断错误信息`。

常用环境变量：

1. `PORT`：测试端口（默认 `12499`）。
2. `REQUEST_TIMEOUT_SECS`：单次请求超时。
3. `PROMPT`：探测用提示词。
4. `MODEL_KEY`：默认 `Custom_Model`。

## 输出与失败判定

1. 脚本使用 `set -euo pipefail`，断言失败会直接退出非 0。
2. 关键日志前缀：`[INFO]`、`[FAIL]`、`VALID`、`INVALID`、`[SKIP]`。
3. `test:tools` 出现 `SKIP` 时通常仍会 0 退出，表示“本次未完成完整断言”。

## 常见问题

1. `Daemon not ready`：先启动 Raycast 的 `Manage AI Server` 或运行 `npm run dev`。
2. 端口冲突：修改 `PORT`/`PORT_A`/`PORT_B`/`PORT_C` 后重试。
3. 请求非 200 且含配额错误：属于上游限额，等待额度恢复后再跑。
