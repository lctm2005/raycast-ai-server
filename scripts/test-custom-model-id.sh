#!/usr/bin/env bash
set -euo pipefail

ADMIN_PORT="${ADMIN_PORT:-46321}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-12499}"
MODEL_KEY="${MODEL_KEY:-Custom_Model}"
MODEL_ID="${MODEL_ID:-${1:-}}"
MODEL_NAME="${MODEL_NAME:-}"
CANDIDATES_FILE="${CANDIDATES_FILE:-}"
MAX_CANDIDATES="${MAX_CANDIDATES:-40}"
AI_MODEL_TYPES_FILE="${AI_MODEL_TYPES_FILE:-node_modules/@raycast/api/types/index.d.ts}"
REQUEST_TIMEOUT_SECS="${REQUEST_TIMEOUT_SECS:-45}"
PROMPT="${PROMPT:-reply with one short word: ok}"
TMP_CANDIDATES_FILE=""

log() { printf "\n[%s] %s\n" "$(date +%H:%M:%S)" "$*"; }
fail() { echo "ERROR: $*" >&2; exit 1; }

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

stop_service() {
  local port="$1"
  curl -sS -X POST "http://${HOST}:${ADMIN_PORT}/admin/stop" -H 'Content-Type: application/json' -d "{\"port\":${port}}" >/dev/null || true
}

wait_health() {
  local port="$1"
  for _ in {1..50}; do
    local code
    code="$(http_code GET "http://${HOST}:${port}/health")" || true
    if [[ "$code" == "200" ]]; then
      return 0
    fi
    sleep 0.2
  done
  return 1
}

start_service_for_model() {
  local model_id="$1"
  local service_id="${model_id}:${PORT}"
  local payload
  payload="$(printf '{"serviceId":"%s","modelKey":"%s","modelValue":"%s","port":%s}' "$service_id" "$MODEL_KEY" "$model_id" "$PORT")"
  local code
  code="$(http_code POST "http://${HOST}:${ADMIN_PORT}/admin/start" "$payload")"
  [[ "$code" =~ ^2[0-9][0-9]$ ]] || return 1
  wait_health "$PORT"
}

probe_model() {
  local model_id="$1"
  local url="http://${HOST}:${PORT}/v1/chat/completions"
  local body
  body="$(printf '{"model":"%s","messages":[{"role":"user","content":"%s"}]}' "$model_id" "$PROMPT")"

  local response
  response="$(curl -sS -m "$REQUEST_TIMEOUT_SECS" -X POST "$url" -H 'Content-Type: application/json' -d "$body" -w $'\n%{http_code}')" || return 2

  local code
  code="$(printf '%s' "$response" | tail -n1)"
  local payload
  payload="$(printf '%s' "$response" | sed '$d')"

  if [[ "$code" == "200" ]]; then
    printf 'VALID\t%s\n' "$model_id"
    return 0
  fi

  printf 'INVALID\t%s\tHTTP_%s\t%s\n' "$model_id" "$code" "$(printf '%s' "$payload" | tr '\n' ' ' | cut -c1-240)"
  return 1
}

run_single() {
  local model_id="$1"
  log "Testing model id: ${model_id}"
  stop_service "$PORT"
  if ! start_service_for_model "$model_id"; then
    fail "Cannot start service for ${model_id}. Check daemon health and port ${PORT}."
  fi
  probe_model "$model_id" || true
  stop_service "$PORT"
}

run_batch() {
  local file="$1"
  [[ -f "$file" ]] || fail "Candidates file not found: $file"

  log "Batch testing candidates from ${file}"
  while IFS= read -r line; do
    local model_id
    model_id="$(printf '%s' "$line" | xargs)"
    [[ -z "$model_id" || "${model_id:0:1}" == "#" ]] && continue

    stop_service "$PORT"
    if ! start_service_for_model "$model_id"; then
      printf 'INVALID\t%s\tSTART_FAILED\n' "$model_id"
      continue
    fi
    probe_model "$model_id" || true
    stop_service "$PORT"
  done <"$file"
}

infer_candidates_file_from_model_name() {
  local model_name="$1"
  local out_file="$2"
  local max_candidates="$3"

  [[ -f "$AI_MODEL_TYPES_FILE" ]] || fail "AI model types file not found: $AI_MODEL_TYPES_FILE"
  command -v node >/dev/null 2>&1 || fail "node is required for MODEL_NAME inference."

  MODEL_NAME_INPUT="$model_name" MAX_CANDIDATES_INPUT="$max_candidates" AI_MODEL_TYPES_FILE_INPUT="$AI_MODEL_TYPES_FILE" node <<'EOF' >"$out_file"
const fs = require("fs");

const queryRaw = process.env.MODEL_NAME_INPUT || "";
const maxCandidates = Number(process.env.MAX_CANDIDATES_INPUT || "12");
const filePath = process.env.AI_MODEL_TYPES_FILE_INPUT;

const raw = fs.readFileSync(filePath, "utf8");

function extractModelEnumValues(source) {
  const marker = "export enum Model";
  const start = source.indexOf(marker);
  if (start < 0) {
    throw new Error("Cannot find `export enum Model` in AI model types file.");
  }
  const braceStart = source.indexOf("{", start);
  if (braceStart < 0) {
    throw new Error("Cannot find opening brace for `export enum Model`.");
  }

  let depth = 0;
  let end = -1;
  for (let i = braceStart; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) {
    throw new Error("Cannot find closing brace for `export enum Model`.");
  }

  const body = source.slice(braceStart + 1, end);
  const regex = /"([^"]+)"\s*=\s*"([^"]+)"/g;
  const values = [];
  let m;
  while ((m = regex.exec(body)) !== null) {
    values.push(m[2]);
  }
  return values;
}

function tokenize(input) {
  return (input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function expandMatchTokens(tokens) {
  const out = new Set();
  for (const token of tokens) {
    if (!token) continue;
    out.add(token);
    const split = token
      .replace(/([a-z])([0-9])/g, "$1 $2")
      .replace(/([0-9])([a-z])/g, "$1 $2")
      .split(/\s+/)
      .filter(Boolean);
    for (const part of split) out.add(part);
  }
  return Array.from(out);
}

function norm(input) {
  return tokenize(input).join(" ");
}

const queryNorm = norm(queryRaw);
const queryTokens = tokenize(queryRaw);
const queryMatchTokens = expandMatchTokens(queryTokens);
const values = extractModelEnumValues(raw);

const providerInfo = new Map(); // provider -> style stats
const suffixStats = new Map(); // suffix -> count
const tokenProviderStats = new Map(); // token -> (provider -> count)
for (const value of values) {
  const pm = value.match(/^([a-z0-9]+)([-_])(.*)$/);
  if (!pm) continue;
  const provider = pm[1];
  const firstSep = pm[2];
  const tail = pm[3];
  if (!providerInfo.has(provider)) {
    providerInfo.set(provider, {
      dash: false,
      underscore: false,
      nestedPrefixes: new Set(), // e.g. openai_o1
      namespaces: new Set(), // e.g. meta-llama
      hasSlash: false,
    });
  }
  const info = providerInfo.get(provider);
  if (firstSep === "-") info.dash = true;
  if (firstSep === "_") info.underscore = true;

  const nested = value.match(/^([a-z0-9]+_[a-z0-9]+)-/);
  if (nested) info.nestedPrefixes.add(nested[1]);

  if (tail.includes("/")) {
    info.hasSlash = true;
    const ns = tail.split("/")[0];
    if (ns) info.namespaces.add(ns);
  }

  const parts = value.toLowerCase().split(/[-_/]/).filter(Boolean);
  const end = parts[parts.length - 1];
  if (end && /^[a-z0-9.]+$/.test(end)) {
    suffixStats.set(end, (suffixStats.get(end) || 0) + 1);
  }

  for (const tok of tokenize(value)) {
    if (!tok || tok.length < 2 || tok === provider || /^[0-9]+$/.test(tok)) continue;
    if (!tokenProviderStats.has(tok)) tokenProviderStats.set(tok, new Map());
    const byProvider = tokenProviderStats.get(tok);
    byProvider.set(provider, (byProvider.get(provider) || 0) + 1);
  }
}

const providersFromPatterns = Array.from(providerInfo.keys()).sort();
const providerScores = new Map();
for (const provider of providersFromPatterns) providerScores.set(provider, 0);
for (const token of queryMatchTokens) {
  if (token.length < 2 || /^[0-9]+$/.test(token)) continue;
  if (providerScores.has(token)) {
    providerScores.set(token, (providerScores.get(token) || 0) + 60);
  }
  const byProvider = tokenProviderStats.get(token);
  if (!byProvider) continue;
  for (const [provider, count] of byProvider.entries()) {
    providerScores.set(provider, (providerScores.get(provider) || 0) + count * 10);
  }
}
const candidateProviders = providersFromPatterns.sort((a, b) => {
  const scoreDiff = (providerScores.get(b) || 0) - (providerScores.get(a) || 0);
  if (scoreDiff !== 0) return scoreDiff;
  return a.localeCompare(b);
});

const knownProviderTokens = new Set(providersFromPatterns);

const coreTokens = queryTokens.filter((t) => !knownProviderTokens.has(t));
const fullBase = queryNorm;
const coreBase = coreTokens.join(" ") || fullBase;

function wordParts(input) {
  const parts = (input || "").match(/[A-Za-z0-9.]+/g) || [];
  return parts.filter(Boolean);
}

function pascalizeToken(t) {
  if (!t) return t;
  if (/^[a-z]+[0-9.]+$/.test(t)) {
    return t[0].toUpperCase() + t.slice(1);
  }
  return t[0].toUpperCase() + t.slice(1).toLowerCase();
}

function makeBaseVariants(input) {
  const rawParts = wordParts(input);
  const canonical = (input || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
  const lowerParts = rawParts.map((t) => t.toLowerCase());
  const pascalParts = rawParts.map((t) => pascalizeToken(t));
  const upperParts = rawParts.map((t) => t.toUpperCase());
  const out = new Set();
  if (lowerParts.length === 0) return out;

  const r1 = rawParts.join("-");
  const r2 = rawParts.join("_");
  const r3 = rawParts.join("");
  const l1 = lowerParts.join("-");
  const l2 = lowerParts.join("-").replace(/\./g, "-");
  const l3 = lowerParts.join("_").replace(/\./g, "_");
  const l4 = lowerParts.join("");
  const u1 = upperParts.join("-");
  const u2 = upperParts.join("_");
  const u3 = upperParts.join("");
  const p1 = pascalParts.join("-");
  const p2 = pascalParts.join("_");
  const p3 = pascalParts.join("");

  for (const v of [canonical, r1, r2, r3, l1, l2, l3, l4, u1, u2, u3, p1, p2, p3]) if (v) out.add(v);

  // Expand common OpenAI-style minor-version variants: 5 -> 5.1/5.2 and 5-1/5-2.
  for (const base of Array.from(out)) {
    const dotMinor = base.replace(/([0-9])$/, "$1.1");
    const dotMinor2 = base.replace(/([0-9])$/, "$1.2");
    const dashMinor = base.replace(/([0-9])$/, "$1-1");
    const dashMinor2 = base.replace(/([0-9])$/, "$1-2");
    for (const v of [dotMinor, dotMinor2, dashMinor, dashMinor2]) {
      if (v !== base) out.add(v);
    }
  }
  return out;
}

const baseVariants = new Set([
  ...makeBaseVariants(coreBase),
  ...makeBaseVariants(fullBase),
]);

const commonSuffixes = Array.from(suffixStats.entries())
  .sort((a, b) => b[1] - a[1])
  .map(([k]) => k)
  .filter((k) => ["mini", "nano", "pro", "turbo", "instant", "latest", "fast", "lite", "instruct", "codex", "beta"].includes(k))
  .slice(0, 10);

const candidates = new Map(); // candidate -> score
function addCandidate(value, bonus) {
  if (!value) return;
  const clean = value.trim().replace(/--+/g, "-").replace(/__+/g, "_");
  if (!clean) return;
  if (!candidates.has(clean)) {
    candidates.set(clean, 0);
  }
  candidates.set(clean, candidates.get(clean) + bonus);
}

function slugStyleBonus(slug) {
  let bonus = 0;
  if (slug.includes("-")) bonus += 4;
  if (slug.includes("_")) bonus -= 6;
  if (/[A-Z]/.test(slug)) bonus -= 1;
  return bonus;
}

for (const provider of candidateProviders) {
  const info = providerInfo.get(provider);
  const providerHintBonus = Math.min(24, Math.max(0, Math.floor((providerScores.get(provider) || 0) / 2)));
  for (const slug of baseVariants) {
    const styleBonus = slugStyleBonus(slug);
    if (info.dash) addCandidate(`${provider}-${slug}`, 20 + styleBonus + providerHintBonus);
    if (info.underscore) addCandidate(`${provider}_${slug}`, 18 + styleBonus + providerHintBonus);

    // Provider nested prefix style, e.g. openai_o1-...
    for (const nestedPrefix of Array.from(info.nestedPrefixes)) {
      addCandidate(`${nestedPrefix}-${slug}`, 24 + styleBonus + providerHintBonus);
    }

    if (info.hasSlash) {
      for (const ns of Array.from(info.namespaces).slice(0, 8)) {
        const nsTokens = tokenize(ns);
        let nsOverlap = 0;
        for (const t of queryMatchTokens) {
          if (nsTokens.includes(t)) nsOverlap += 1;
        }
        const nsBonus = nsOverlap * 8;
        if (info.dash) addCandidate(`${provider}-${ns}/${slug}`, 14 + styleBonus + providerHintBonus + nsBonus);
      }
    }

    for (const suf of commonSuffixes) {
      if (info.dash) addCandidate(`${provider}-${slug}-${suf}`, 10 + styleBonus + providerHintBonus);
      if (info.underscore) addCandidate(`${provider}_${slug}-${suf}`, 8 + styleBonus + providerHintBonus);
    }
  }
}

const scored = [];
for (const value of candidates.keys()) {
  const valueTokens = new Set(expandMatchTokens(tokenize(value)));
  let score = candidates.get(value) || 0;
  let overlap = 0;
  for (const t of queryMatchTokens) {
    if (valueTokens.has(t)) overlap += 1;
  }
  score += overlap * 8;
  if (queryNorm && norm(value).includes(queryNorm)) score += 20;
  scored.push({ value, score });
}

scored.sort((a, b) => b.score - a.score || a.value.localeCompare(b.value));
for (const item of scored.slice(0, Math.max(1, maxCandidates))) {
  console.log(item.value);
}
EOF

  if [[ ! -s "$out_file" ]]; then
    fail "No candidates inferred from MODEL_NAME='${model_name}'."
  fi

  log "Inferred candidate model ids from MODEL_NAME='${model_name}'"
  nl -ba "$out_file"
}

log "Checking daemon health on ${HOST}:${ADMIN_PORT}"
daemon_code="$(http_code GET "http://${HOST}:${ADMIN_PORT}/admin/health")" || true
[[ "$daemon_code" == "200" ]] || fail "Daemon not ready. Start one service from Raycast UI first."

trap 'stop_service "$PORT"; [[ -n "$TMP_CANDIDATES_FILE" ]] && rm -f "$TMP_CANDIDATES_FILE"' EXIT

if [[ -n "$CANDIDATES_FILE" ]]; then
  run_batch "$CANDIDATES_FILE"
elif [[ -n "$MODEL_ID" ]]; then
  run_single "$MODEL_ID"
elif [[ -n "$MODEL_NAME" ]]; then
  TMP_CANDIDATES_FILE="$(mktemp -t model-candidates.XXXXXX)"
  infer_candidates_file_from_model_name "$MODEL_NAME" "$TMP_CANDIDATES_FILE" "$MAX_CANDIDATES"
  run_batch "$TMP_CANDIDATES_FILE"
else
  fail "Provide MODEL_ID=<id> (or first arg), CANDIDATES_FILE=<path>, or MODEL_NAME=<name>."
fi
