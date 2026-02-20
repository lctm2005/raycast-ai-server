# Test Cases

## Preconditions

- Run `Manage AI Server` in Raycast at least once.
- Start at least one service from UI so internal daemon is alive.
- Ensure target ports are free before test (examples below use `1235`, `1236`, `1237`).

## 1. Single Service Start/Stop

1. In `Manage AI Server`, start `Perplexity Sonar Pro` on port `1235`.
2. Verify `GET http://127.0.0.1:1235/health` returns `ok: true`.
3. Verify `GET http://127.0.0.1:1235/v1/models` returns one model entry.
4. Stop this service in UI.
5. Verify `http://127.0.0.1:1235/health` is no longer reachable.

Expected:
- Service status transitions `starting -> running -> stopped`.
- No duplicate record for same `model+port`.

## 2. Multi-Service Concurrency (Core Regression)

1. Start service A: `Perplexity Sonar Pro` on `1235`.
2. Start service B: `Google Gemini 2.0 Flash` on `1236`.
3. Start service C: `Anthropic Claude Sonnet` on `1237`.
4. Verify all ports are healthy at the same time.
5. Stop service B only.
6. Verify A and C stay healthy.
7. Restart B and verify all 3 are healthy again.

Expected:
- Starting the 3rd service does not stop any existing service.
- Stop operation is isolated to selected port.

## 3. Duplicate & Conflict Handling

1. Start `Perplexity Sonar Pro` on `1235`.
2. Start the same model and port again.
3. Start a different model on the same port `1235`.

Expected:
- Same model+port behaves idempotently (no duplicate record).
- Different model on same port is rejected with clear error.

## 4. API Compatibility

1. Non-stream request to `/v1/chat/completions`.
2. Stream request (`stream=true`) to `/v1/chat/completions`.
3. Request to `/chat/completions` (non-v1 alias).

Expected:
- JSON shape compatible with OpenAI Chat Completions.
- Streaming returns SSE chunks and `[DONE]` terminator.

## 5. Persistence Behavior

1. Start 2+ services.
2. Close `Manage AI Server` command UI.
3. Verify ports still healthy via curl.

Expected:
- Services stay alive after leaving management UI.

## 6. Extension Restart Recovery

1. Start services on 2+ ports.
2. Restart Raycast extension.
3. Open `Manage AI Server` and click `Refresh`.

Expected:
- Running services show as `running` after refresh.
- Stopped services show as `stopped`.
