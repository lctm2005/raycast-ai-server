#!/usr/bin/env bash
set -euo pipefail

ADMIN_PORT="${ADMIN_PORT:-46321}"
HOST="127.0.0.1"

PORT_A="${PORT_A:-1235}"
PORT_B="${PORT_B:-1236}"
PORT_C="${PORT_C:-1237}"

MODEL_A_KEY="${MODEL_A_KEY:-Perplexity_Sonar_Pro}"
MODEL_A_VAL="${MODEL_A_VAL:-perplexity-sonar-pro}"
MODEL_B_KEY="${MODEL_B_KEY:-Google_Gemini_2.0_Flash}"
MODEL_B_VAL="${MODEL_B_VAL:-google-gemini-2.0-flash}"
MODEL_C_KEY="${MODEL_C_KEY:-Anthropic_Claude_Sonnet}"
MODEL_C_VAL="${MODEL_C_VAL:-anthropic-claude-sonnet}"

SERVICE_A_ID="${MODEL_A_VAL}:${PORT_A}"
SERVICE_B_ID="${MODEL_B_VAL}:${PORT_B}"
SERVICE_C_ID="${MODEL_C_VAL}:${PORT_C}"

log() { printf "\n[%s] %s\n" "$(date +%H:%M:%S)" "$*"; }
fail() { echo "ERROR: $*" >&2; exit 1; }

curl_json() {
  local method="$1"
  local url="$2"
  local body="${3:-}"
  if [[ -n "$body" ]]; then
    curl -sS -X "$method" "$url" -H 'Content-Type: application/json' -d "$body"
  else
    curl -sS -X "$method" "$url"
  fi
}

http_code() {
  local method="$1"
  local url="$2"
  local body="${3:-}"
  if [[ -n "$body" ]]; then
    curl -s -o /dev/null -w '%{http_code}' -X "$method" "$url" -H 'Content-Type: application/json' -d "$body"
  else
    curl -s -o /dev/null -w '%{http_code}' -X "$method" "$url"
  fi
}

assert_2xx() {
  local code="$1"
  [[ "$code" =~ ^2[0-9][0-9]$ ]] || fail "Expected 2xx, got $code"
}

wait_health() {
  local port="$1"
  for _ in {1..20}; do
    local code
    code="$(http_code GET "http://${HOST}:${port}/health")" || true
    if [[ "$code" == "200" ]]; then
      return 0
    fi
    sleep 0.2
  done
  fail "Service on port ${port} is not healthy"
}

wait_down() {
  local port="$1"
  for _ in {1..20}; do
    local code
    code="$(http_code GET "http://${HOST}:${port}/health")" || true
    if [[ "$code" != "200" ]]; then
      return 0
    fi
    sleep 0.2
  done
  fail "Service on port ${port} did not stop"
}

log "Checking daemon health on ${HOST}:${ADMIN_PORT}"
code="$(http_code GET "http://${HOST}:${ADMIN_PORT}/admin/health")" || true
if [[ "$code" != "200" ]]; then
  fail "Daemon not ready. Start one service from Raycast UI first, then rerun."
fi

start_payload() {
  local sid="$1"; local mkey="$2"; local mval="$3"; local port="$4"
  printf '{"serviceId":"%s","modelKey":"%s","modelValue":"%s","port":%s}' "$sid" "$mkey" "$mval" "$port"
}

log "Starting A (${MODEL_A_KEY}:${PORT_A})"
code="$(http_code POST "http://${HOST}:${ADMIN_PORT}/admin/start" "$(start_payload "$SERVICE_A_ID" "$MODEL_A_KEY" "$MODEL_A_VAL" "$PORT_A")")"
assert_2xx "$code"
wait_health "$PORT_A"

log "Starting B (${MODEL_B_KEY}:${PORT_B})"
code="$(http_code POST "http://${HOST}:${ADMIN_PORT}/admin/start" "$(start_payload "$SERVICE_B_ID" "$MODEL_B_KEY" "$MODEL_B_VAL" "$PORT_B")")"
assert_2xx "$code"
wait_health "$PORT_B"

log "Starting C (${MODEL_C_KEY}:${PORT_C})"
code="$(http_code POST "http://${HOST}:${ADMIN_PORT}/admin/start" "$(start_payload "$SERVICE_C_ID" "$MODEL_C_KEY" "$MODEL_C_VAL" "$PORT_C")")"
assert_2xx "$code"
wait_health "$PORT_C"

log "Verifying all three services are healthy"
assert_2xx "$(http_code GET "http://${HOST}:${PORT_A}/health")"
assert_2xx "$(http_code GET "http://${HOST}:${PORT_B}/health")"
assert_2xx "$(http_code GET "http://${HOST}:${PORT_C}/health")"

log "Stopping B only"
code="$(http_code POST "http://${HOST}:${ADMIN_PORT}/admin/stop" "{\"port\":${PORT_B}}")"
assert_2xx "$code"
wait_down "$PORT_B"

log "Ensuring A and C are still healthy"
assert_2xx "$(http_code GET "http://${HOST}:${PORT_A}/health")"
assert_2xx "$(http_code GET "http://${HOST}:${PORT_C}/health")"

log "Duplicate start on A should be idempotent"
code="$(http_code POST "http://${HOST}:${ADMIN_PORT}/admin/start" "$(start_payload "$SERVICE_A_ID" "$MODEL_A_KEY" "$MODEL_A_VAL" "$PORT_A")")"
assert_2xx "$code"

log "Port conflict test: different serviceId/model on PORT_A should fail"
code="$(http_code POST "http://${HOST}:${ADMIN_PORT}/admin/start" "$(start_payload "conflict:${PORT_A}" "$MODEL_B_KEY" "$MODEL_B_VAL" "$PORT_A")")"
[[ "$code" == "409" ]] || fail "Expected 409 conflict, got $code"

log "Smoke test passed"
