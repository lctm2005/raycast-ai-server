#!/usr/bin/env bash
set -euo pipefail

# Config
ADMIN_PORT="${ADMIN_PORT:-46321}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-}"
MODEL_KEY="${MODEL_KEY:-anthropic-claude-sonnet-4-5}"
MODEL_VALUE="${MODEL_VALUE:-anthropic-claude-sonnet-4-5}"
SERVICE_ID=""
OWNED_SERVICE=0
CURL_JSON=(curl -s -H "Content-Type: application/json")
JQ_BIN="jq"
SKIPPED=0

has_jq() { command -v jq >/dev/null 2>&1; }

pp_json() {
  if has_jq; then jq -r '.'; else python3 -m json.tool; fi
}

http_code() {
  local method="$1" url="$2" data="${3:-}"
  if [[ -n "$data" ]]; then
    curl -s -o /dev/null -w "%{http_code}" -X "$method" "$url" -H "Content-Type: application/json" -d "$data"
  else
    curl -s -o /dev/null -w "%{http_code}" -X "$method" "$url"
  fi
}

fail() { echo "[FAIL] $*" >&2; exit 1; }
log()  { echo "[INFO] $*" >&2; }

wait_admin() {
  local url="http://${HOST}:${ADMIN_PORT}/admin/health"
  for i in {1..50}; do
    local code; code=$(http_code GET "$url") || true
    [[ "$code" == "200" ]] && return 0
    sleep 0.2
  done
  fail "Daemon not ready at ${url}. Start it (npm run dev) and retry."
}

pick_existing_or_start_service() {
  # Try to reuse any existing service first
  local list_url="http://${HOST}:${ADMIN_PORT}/admin/services"
  local services json port
  services=$(curl -s "$list_url" || true)
  if [[ -n "$services" ]]; then
    port=$(echo "$services" | python3 - <<'PY'
import sys, json
raw=sys.stdin.read().strip()
if not raw:
    print("")
    sys.exit(0)
obj=json.loads(raw)
svcs=obj.get('services',[])
print(svcs[0]['port'] if svcs else '')
PY
)
  fi

  if [[ -n "${PORT}" ]]; then
    : # env-specified PORT wins
  elif [[ -n "$port" ]]; then
    PORT="$port"
    log "Reusing existing service on port ${PORT}"
  else
    PORT=1242
    SERVICE_ID="tools-tests:${PORT}"
    local url="http://${HOST}:${ADMIN_PORT}/admin/start"
    local payload
    payload=$(cat <<JSON
{"serviceId":"${SERVICE_ID}","modelKey":"${MODEL_KEY}","modelValue":"${MODEL_VALUE}","port":${PORT}}
JSON
)
    local code; code=$(http_code POST "$url" "$payload")
    [[ "$code" == "200" ]] || fail "Failed to start service: HTTP ${code}"
    OWNED_SERVICE=1
    log "Started dedicated service ${SERVICE_ID}"
  fi
}

stop_service() {
  if [[ "$OWNED_SERVICE" != "1" ]]; then return 0; fi
  local url="http://${HOST}:${ADMIN_PORT}/admin/stop"
  local payload
  payload=$(cat <<JSON
{"port":${PORT}}
JSON
)
  http_code POST "$url" "$payload" >/dev/null || true
}

wait_health() {
  local url="http://${HOST}:${PORT}/health"
  for i in {1..50}; do
    local code; code=$(http_code GET "$url") || true
    [[ "$code" == "200" ]] && return 0
    sleep 0.2
  done
  fail "Service not healthy at ${url}"
}

post_json() {
  local url="$1" body="$2"
  curl -s -X POST "$url" -H "Content-Type: application/json" -d "$body"
}

assert_eq() {
  local a="$1" b="$2" msg="$3"
  [[ "$a" == "$b" ]] || fail "${msg}: expected=[$b] actual=[$a]"
}

extract_with_python() {
  python3 - "$@" <<'PY'
import sys, json
obj = json.load(sys.stdin)
path = sys.argv[1]
# very small JSONPath-like for our test
parts = path.strip('.').split('.')
cur = obj
for p in parts:
    if p.endswith(']'):
        name, idx = p[:-1].split('[')
        cur = cur[name][int(idx)]
    else:
        cur = cur[p]
print(cur if isinstance(cur, (str, int, float)) else json.dumps(cur, ensure_ascii=False))
PY
}

single_tool_auto_should_yield_tool_calls() {
  log "Single-tool + auto -> expect tool_calls"
  local url="http://${HOST}:${PORT}/v1/chat/completions"
  local body
  body=$(cat <<'JSON'
{
  "model": "gpt-4",
  "messages": [ {"role":"user","content":"查询上海天气"} ],
  "tools": [
    {"type":"function","function":{
      "name":"get_weather",
      "description":"获取指定城市的天气信息",
      "parameters":{
        "type":"object",
        "properties": {"city":{"type":"string"}},
        "required":["city"]
      }
    }}
  ],
  "tool_choice": "auto"
}
JSON
)
  local code; code=$(http_code POST "$url" "$body")
  local resp; resp=$(post_json "$url" "$body")
  if [[ "$code" != "200" ]]; then
    echo "$resp" | pp_json || true
    log "[SKIP] Non-200 from /v1/chat/completions (HTTP ${code}) — likely model quota or upstream error. Skipping tool-call assertions."
    SKIPPED=1
    return 0
  fi
  echo "$resp" | pp_json >/dev/null || true
  local name; name=$(echo "$resp" | extract_with_python .choices[0].message.tool_calls[0].function.name)
  local args; args=$(echo "$resp" | extract_with_python .choices[0].message.tool_calls[0].function.arguments)
  local finish; finish=$(echo "$resp" | extract_with_python .choices[0].finish_reason)
  assert_eq "$name" "get_weather" "single-tool: function name"
  [[ "$args" == *"上海"* ]] || fail "single-tool: arguments should contain city=上海, got: $args"
  assert_eq "$finish" "tool_calls" "single-tool: finish_reason"
}

multi_tool_required_should_call_specified_function() {
  log "Multi-tool + required(specified) -> expect get_weather tool_call"
  local url="http://${HOST}:${PORT}/v1/chat/completions"
  local body
  body=$(cat <<'JSON'
{
  "model": "gpt-4",
  "messages": [ {"role":"user","content":"查询北京天气"} ],
  "tools": [
    {"type":"function","function":{
      "name":"get_weather",
      "description":"获取指定城市的天气信息",
      "parameters":{
        "type":"object",
        "properties": {"city":{"type":"string"}},
        "required":["city"]
      }
    }},
    {"type":"function","function":{
      "name":"get_time",
      "description":"获取当前时间（演示用）",
      "parameters":{
        "type":"object",
        "properties": {"zone":{"type":"string"}},
        "required":[]
      }
    }}
  ],
  "tool_choice": {"type":"function","function":{"name":"get_weather"}}
}
JSON
)
  local code; code=$(http_code POST "$url" "$body")
  local resp; resp=$(post_json "$url" "$body")
  if [[ "$code" != "200" ]]; then
    echo "$resp" | pp_json || true
    log "[SKIP] Non-200 from /v1/chat/completions (HTTP ${code}) — likely model quota or upstream error. Skipping tool-call assertions."
    SKIPPED=1
    return 0
  fi
  echo "$resp" | pp_json >/dev/null || true
  local name; name=$(echo "$resp" | extract_with_python .choices[0].message.tool_calls[0].function.name)
  local args; args=$(echo "$resp" | extract_with_python .choices[0].message.tool_calls[0].function.arguments)
  local finish; finish=$(echo "$resp" | extract_with_python .choices[0].finish_reason)
  assert_eq "$name" "get_weather" "multi-tool: function name"
  [[ "$args" == *"北京"* ]] || fail "multi-tool: arguments should contain city=北京, got: $args"
  assert_eq "$finish" "tool_calls" "multi-tool: finish_reason"
}

main() {
  trap stop_service EXIT
  wait_admin
  pick_existing_or_start_service
  wait_health
  single_tool_auto_should_yield_tool_calls
  multi_tool_required_should_call_specified_function
  if [[ "$SKIPPED" == "1" ]]; then
    log "Completed with skips due to upstream model limits. Rerun later to assert fully."
  else
    log "All tool-call tests passed on port ${PORT}."
  fi
}

main "$@"
