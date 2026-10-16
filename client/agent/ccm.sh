#!/usr/bin/env bash
# Claude Code usage monitor agent (macOS / Linux / WSL).
#
#   ccm statusline   Claude Code status line: shows limits, forwards them to the dashboard
#   ccm hook         SessionStart hook: heartbeat + background self-update
#   ccm doctor       Checks the installation end to end and explains any fix
#   ccm update       Downloads the latest agent now
#   ccm version      Prints the agent version
#   ccm uninstall    Removes the agent and its Claude Code settings (needs sudo)
#
# The copy installed under the system directory is a stable launcher: when a newer agent has been
# downloaded to ~/.ccm/agent, it hands over to that copy. Compatible with bash 3.2 (macOS).

CCM_AGENT_VERSION=1
MIN_CLAUDE_VERSION="2.1.200"

# ---------------------------------------------------------------------------------------------
# Launcher: prefer a newer downloaded agent. Keep this block small; it can never update itself.
if [ -z "$CCM_DELEGATED" ]; then
  CCM_INSTALL_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd)"
  export CCM_INSTALL_DIR
  _cached="${HOME}/.ccm/agent/ccm.sh"
  if [ -f "$_cached" ]; then
    _v="$(sed -n 's/^CCM_AGENT_VERSION=\([0-9][0-9]*\)$/\1/p' "$_cached" | head -n 1)"
    if [ -n "$_v" ] && [ "$_v" -gt "$CCM_AGENT_VERSION" ] 2>/dev/null; then
      CCM_DELEGATED=1 exec bash "$_cached" "$@"
    fi
  fi
fi
# ---------------------------------------------------------------------------------------------

CONF="${CCM_INSTALL_DIR}/config"
STATE_DIR="${HOME}/.ccm"
CCM_URL="" CCM_TOKEN="" DEVICE_ID="" DEV_NAME="" TEAM="" SETTINGS_FILE="" SETTINGS_VERSION="0"
AUTO_UPDATE="1" CHAIN_STATUSLINE=""

load_config() {
  [ -r "$CONF" ] || return 1
  local line key val
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; esac
    key="${line%%=*}"
    val="${line#*=}"
    case "$key" in
      CCM_URL) CCM_URL="${val%/}" ;;
      CCM_TOKEN) CCM_TOKEN="$val" ;;
      DEVICE_ID) DEVICE_ID="$val" ;;
      DEV_NAME) DEV_NAME="$val" ;;
      TEAM) TEAM="$val" ;;
      SETTINGS_FILE) SETTINGS_FILE="$val" ;;
      SETTINGS_VERSION) SETTINGS_VERSION="$val" ;;
      AUTO_UPDATE) AUTO_UPDATE="$val" ;;
      CHAIN_STATUSLINE_B64) CHAIN_STATUSLINE="$(printf '%s' "$val" | base64 -d 2>/dev/null || printf '%s' "$val" | base64 -D 2>/dev/null)" ;;
    esac
  done < "$CONF"
  [ -n "$CCM_URL" ] && [ -n "$CCM_TOKEN" ]
}

json_str() {
  # Escapes a value for embedding in a JSON string.
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\t/\\t/g' | tr -d '\r\n'
}

json_field() {
  # Usage: json_field <json> <key>  -> first string value for "key" (flat lookup, no jq needed).
  printf '%s' "$1" | grep -o "\"$2\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -n 1 | sed 's/.*"\([^"]*\)"$/\1/'
}

json_num_in() {
  # Usage: json_num_in <json> <object-key> <field>  -> numeric field inside a flat object.
  printf '%s' "$1" | grep -o "\"$2\"[[:space:]]*:[[:space:]]*{[^}]*}" | head -n 1 \
    | grep -o "\"$3\"[[:space:]]*:[[:space:]]*[0-9.]*" | head -n 1 | sed 's/.*:[[:space:]]*//'
}

claude_json_path() {
  if [ -n "$CLAUDE_CONFIG_DIR" ] && [ -f "$CLAUDE_CONFIG_DIR/.claude.json" ]; then
    printf '%s' "$CLAUDE_CONFIG_DIR/.claude.json"
  else
    printf '%s' "$HOME/.claude.json"
  fi
}

# Signed-in account, read from Claude Code's own state file.
ACCOUNT_EMAIL="" ACCOUNT_UUID="" ACCOUNT_ORG_TYPE="" ACCOUNT_TIER="" ACCOUNT_NAME=""
load_account() {
  local f content
  f="$(claude_json_path)"
  [ -r "$f" ] || return 1
  # oauthAccount holds nested objects, so take the text that follows the key and read flat fields from it.
  content="$(tr -d '\r\n' < "$f" 2>/dev/null | grep -o '"oauthAccount"[[:space:]]*:[[:space:]]*{.*' | cut -c1-6000)"
  [ -n "$content" ] || return 1
  ACCOUNT_EMAIL="$(json_field "$content" emailAddress | tr 'A-Z' 'a-z')"
  ACCOUNT_UUID="$(json_field "$content" accountUuid)"
  ACCOUNT_ORG_TYPE="$(json_field "$content" organizationType)"
  ACCOUNT_TIER="$(json_field "$content" organizationRateLimitTier)"
  [ -n "$ACCOUNT_TIER" ] || ACCOUNT_TIER="$(json_field "$content" userRateLimitTier)"
  ACCOUNT_NAME="$(json_field "$content" displayName)"
  [ -n "$ACCOUNT_EMAIL" ]
}

os_name() { uname -s 2>/dev/null || echo unknown; }
os_version() {
  if [ "$(uname -s)" = "Darwin" ]; then sw_vers -productVersion 2>/dev/null
  elif [ -r /etc/os-release ]; then (. /etc/os-release; printf '%s' "${PRETTY_NAME:-$NAME}")
  else uname -r; fi
}
host_name() { hostname 2>/dev/null || uname -n; }

http() {
  # Usage: http METHOD PATH [BODY]  -> prints body, sets HTTP_STATUS. Never fails the caller.
  local method="$1" path="$2" body="$3" out
  if [ -n "$body" ]; then
    out="$(printf '%s' "$body" | curl -sS -m 10 -X "$method" "${CCM_URL}${path}" \
      -H "Authorization: Bearer ${CCM_TOKEN}" -H "Content-Type: application/json" \
      --data-binary @- -w '\n%{http_code}' 2>/dev/null)"
  else
    out="$(curl -sS -m 10 -X "$method" "${CCM_URL}${path}" \
      -H "Authorization: Bearer ${CCM_TOKEN}" -w '\n%{http_code}' 2>/dev/null)"
  fi
  HTTP_STATUS="$(printf '%s' "$out" | tail -n 1)"
  [ -n "$HTTP_STATUS" ] || HTTP_STATUS="000"
  printf '%s' "$out" | sed '$d'
}

account_json() {
  if load_account; then
    printf '{"email":"%s","account_uuid":"%s","organization_type":"%s","rate_limit_tier":"%s","display_name":"%s"}' \
      "$(json_str "$ACCOUNT_EMAIL")" "$(json_str "$ACCOUNT_UUID")" "$(json_str "$ACCOUNT_ORG_TYPE")" \
      "$(json_str "$ACCOUNT_TIER")" "$(json_str "$ACCOUNT_NAME")"
  else
    printf 'null'
  fi
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

# Downloads the latest agent into ~/.ccm/agent when the server has a newer version.
self_update() {
  local force="$1" headers tmp latest sha actual
  [ "$AUTO_UPDATE" = "1" ] || [ "$force" = "force" ] || return 0
  mkdir -p "$STATE_DIR/agent" || return 1
  tmp="$STATE_DIR/agent/ccm.sh.download"
  headers="$(curl -sS -m 20 -D - -o "$tmp" -H "Authorization: Bearer ${CCM_TOKEN}" \
    "${CCM_URL}/api/client/agent?platform=posix" 2>/dev/null | tr -d '\r')"
  latest="$(printf '%s' "$headers" | grep -i '^x-ccm-agent-version:' | head -n 1 | sed 's/^[^:]*:[[:space:]]*//')"
  sha="$(printf '%s' "$headers" | grep -i '^x-ccm-sha256:' | head -n 1 | sed 's/^[^:]*:[[:space:]]*//')"
  if [ -z "$latest" ] || [ -z "$sha" ] || [ ! -s "$tmp" ]; then rm -f "$tmp"; return 1; fi
  actual="$(sha256_of "$tmp")"
  if [ "$actual" != "$sha" ]; then rm -f "$tmp"; return 1; fi
  if [ "$latest" -gt "$CCM_AGENT_VERSION" ] 2>/dev/null || [ "$force" = "force" ]; then
    chmod 755 "$tmp" && mv -f "$tmp" "$STATE_DIR/agent/ccm.sh"
    printf '%s' "$latest"
  else
    rm -f "$tmp"
  fi
}

heartbeat() {
  local check_json="${1:-null}" resp latest notice
  resp="$(http POST /api/client/heartbeat "$(printf '{"device_id":"%s","dev_name":"%s","team":"%s","host_name":"%s","os_type":"%s","os_version":"%s","agent_version":%s,"settings_version":%s,"account":%s,"check":%s}' \
    "$(json_str "$DEVICE_ID")" "$(json_str "$DEV_NAME")" "$(json_str "$TEAM")" "$(json_str "$(host_name)")" \
    "$(json_str "$(os_name)")" "$(json_str "$(os_version)")" "$CCM_AGENT_VERSION" "${SETTINGS_VERSION:-0}" \
    "$(account_json)" "$check_json")")"
  [ "$HTTP_STATUS" = "200" ] || return 1
  mkdir -p "$STATE_DIR"
  notice="$(json_field "$resp" notice)"
  if [ -n "$notice" ]; then printf '%s' "$notice" > "$STATE_DIR/notice"; else rm -f "$STATE_DIR/notice"; fi
  latest="$(printf '%s' "$resp" | grep -o '"latest_agent_version"[[:space:]]*:[[:space:]]*[0-9]*' | sed 's/.*:[[:space:]]*//')"
  if [ -n "$latest" ] && [ "$latest" -gt "$CCM_AGENT_VERSION" ] 2>/dev/null; then self_update >/dev/null; fi
  return 0
}

# ------------------------------------------------------------------------------- statusline
pct_color() {
  # Prints the value with an ANSI color by severity: <70 default, 70-89 yellow, >=90 red.
  local v="${1%.*}"
  if [ "${v:-0}" -ge 90 ] 2>/dev/null; then printf '\033[31m%s%%\033[0m' "$v"
  elif [ "${v:-0}" -ge 70 ] 2>/dev/null; then printf '\033[33m%s%%\033[0m' "$v"
  else printf '%s%%' "$v"; fi
}

forward_statusline() {
  local input="$1" session="$2" sync="$3"
  load_account >/dev/null 2>&1
  local send=(curl -s -m 8 -o /dev/null -w '%{http_code}' -X POST "${CCM_URL}/api/limits"
    -H "Authorization: Bearer ${CCM_TOKEN}" -H "Content-Type: application/json"
    -H "X-CCM-Device: ${DEVICE_ID}" -H "X-CCM-Host: $(host_name)" -H "X-CCM-OS: $(os_name)"
    -H "X-CCM-Attrs: $(printf 'dev.name=%s,team=%s' "$DEV_NAME" "$TEAM" | sed 's/ /%20/g')"
    -H "X-CCM-Email: ${ACCOUNT_EMAIL}" -H "X-CCM-Tier: ${ACCOUNT_TIER}"
    --data-binary @-)
  if [ "$sync" = "sync" ]; then
    printf '%s' "$input" | "${send[@]}" 2>/dev/null
  else
    (printf '%s' "$input" | "${send[@]}" >/dev/null 2>&1 &)
  fi
}

cmd_statusline() {
  local input session five week ctx model out now last stamp chained
  input="$(cat)"
  load_config >/dev/null 2>&1
  session="$(json_field "$input" session_id)"

  if [ -n "$CCM_URL" ] && [ -n "$session" ]; then
    mkdir -p "$STATE_DIR/sessions" 2>/dev/null
    stamp="$STATE_DIR/sessions/${session}"
    now="$(date +%s)"
    last="$(cat "$stamp" 2>/dev/null || echo 0)"
    if [ $((now - last)) -ge 60 ]; then
      printf '%s' "$now" > "$stamp" 2>/dev/null
      forward_statusline "$input" "$session"
    fi
  fi

  if [ -n "$CHAIN_STATUSLINE" ]; then
    chained="$(printf '%s' "$input" | bash -c "$CHAIN_STATUSLINE" 2>/dev/null)"
    [ -n "$chained" ] && printf '%s\n' "$chained"
  fi

  model="$(json_field "$input" display_name)"
  five="$(json_num_in "$input" five_hour used_percentage)"
  week="$(json_num_in "$input" seven_day used_percentage)"
  ctx="$(printf '%s' "$input" | grep -o '"context_window"[[:space:]]*:[[:space:]]*{.*' | grep -o '"used_percentage"[[:space:]]*:[[:space:]]*[0-9.]*' | head -n 1 | sed 's/.*:[[:space:]]*//')"
  out="${model:-Claude}"
  [ -n "$week" ] && out="$out · week $(pct_color "$week")"
  [ -n "$five" ] && out="$out · 5h $(pct_color "$five")"
  [ -n "$ctx" ] && out="$out · ctx ${ctx%.*}%"
  [ -f "$STATE_DIR/notice" ] && out="$out · \033[33m$(cat "$STATE_DIR/notice")\033[0m"
  printf '%b\n' "$out"
}

# ------------------------------------------------------------------------------------- hook
cmd_hook() {
  cat >/dev/null 2>&1
  load_config >/dev/null 2>&1 || exit 0
  # Detach so the session start is never delayed by the network.
  ( heartbeat >/dev/null 2>&1 & ) >/dev/null 2>&1
  find "$STATE_DIR/sessions" -type f -mtime +7 -exec rm -f {} + 2>/dev/null
  exit 0
}

# ----------------------------------------------------------------------------------- doctor
if [ -t 1 ]; then
  C_OK=$'\033[32m' C_WARN=$'\033[33m' C_FAIL=$'\033[31m' C_DIM=$'\033[2m' C_BOLD=$'\033[1m' C_RESET=$'\033[0m'
else
  C_OK="" C_WARN="" C_FAIL="" C_DIM="" C_BOLD="" C_RESET=""
fi
N_OK=0 N_WARN=0 N_FAIL=0 CHECKS_JSON=""

report() {
  # Usage: report ok|warn|fail "Title" "detail" ["fix"]
  local status="$1" title="$2" detail="$3" fix="$4" icon color
  case "$status" in
    ok) icon="✓"; color="$C_OK"; N_OK=$((N_OK + 1)) ;;
    warn) icon="!"; color="$C_WARN"; N_WARN=$((N_WARN + 1)) ;;
    *) icon="✗"; color="$C_FAIL"; N_FAIL=$((N_FAIL + 1)) ;;
  esac
  printf '  %s%s%s %-20s %s\n' "$color" "$icon" "$C_RESET" "$title" "$detail"
  [ -n "$fix" ] && printf '    %s→ %s%s\n' "$C_DIM" "$fix" "$C_RESET"
  CHECKS_JSON="${CHECKS_JSON}${CHECKS_JSON:+,}{\"status\":\"$status\",\"title\":\"$(json_str "$title")\",\"detail\":\"$(json_str "$detail")\",\"fix\":\"$(json_str "$fix")\"}"
}

version_lt() {
  # True when $1 < $2 (dotted numeric versions).
  [ "$1" = "$2" ] && return 1
  local lower
  lower="$(printf '%s\n%s\n' "$1" "$2" | sort -t. -k1,1n -k2,2n -k3,3n | head -n 1)"
  [ "$lower" = "$1" ]
}

CLAUDE_VERSIONS=""
find_claude_installs() {
  # Prints "label|version" lines for every Claude Code install found for this user.
  local bin v dir
  for bin in "$(command -v claude 2>/dev/null)" "$HOME/.local/bin/claude" "$HOME/.claude/local/claude"; do
    [ -n "$bin" ] && [ -x "$bin" ] || continue
    v="$("$bin" --version 2>/dev/null | head -n 1 | grep -o '[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*' | head -n 1)"
    [ -n "$v" ] && printf 'CLI (%s)|%s\n' "$bin" "$v"
  done | sort -u
  for dir in "$HOME/.vscode/extensions" "$HOME/.vscode-server/extensions" "$HOME/.cursor/extensions" \
             "$HOME/.cursor-server/extensions" "$HOME/.windsurf/extensions" "$HOME/.vscode-insiders/extensions"; do
    [ -d "$dir" ] || continue
    for ext in "$dir"/anthropic.claude-code-*; do
      [ -d "$ext" ] || continue
      v="$(basename "$ext" | grep -o '[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*' | head -n 1)"
      [ -n "$v" ] && printf '%s extension|%s\n' "$(basename "$(dirname "$dir")" | sed 's/^\.//')" "$v"
    done
  done
}

cmd_doctor() {
  local t0 t1 body nonce resp found last_at last_name sl_status latest_ext
  printf '\n%sClaude Code usage monitor · doctor%s  %sagent v%s%s\n\n' "$C_BOLD" "$C_RESET" "$C_DIM" "$CCM_AGENT_VERSION" "$C_RESET"

  # 1. Installation
  if load_config; then
    report ok "Installation" "${CCM_INSTALL_DIR} · ${DEV_NAME:-?}${TEAM:+ ($TEAM)} · device ${DEVICE_ID:0:8}"
  else
    report fail "Installation" "config missing or incomplete at ${CONF}" "Re-run the installer from the dashboard's Setup page"
    printf '\n'; return 1
  fi

  # 2. Settings file
  if [ -z "$SETTINGS_FILE" ] || [ ! -f "$SETTINGS_FILE" ]; then
    report fail "Claude settings" "settings file not found: ${SETTINGS_FILE:-unset}" "Re-run the installer (needs sudo)"
  elif ! grep -q "CCM_SETTINGS_VERSION" "$SETTINGS_FILE" 2>/dev/null; then
    report fail "Claude settings" "${SETTINGS_FILE} does not contain the monitor settings" "Re-run the installer (needs sudo)"
  elif python3 -c 'import json' >/dev/null 2>&1 && ! python3 -c 'import json,sys; json.load(sys.stdin)' < "$SETTINGS_FILE" 2>/dev/null; then
    report fail "Claude settings" "${SETTINGS_FILE} is not valid JSON; Claude Code will refuse to start" "Re-run the installer, or delete the file"
  elif ! grep -q "$CCM_URL" "$SETTINGS_FILE"; then
    report warn "Claude settings" "endpoint in ${SETTINGS_FILE} differs from ${CCM_URL}" "Re-run the installer to rewrite the settings"
  else
    report ok "Claude settings" "${SETTINGS_FILE} (telemetry on, v${SETTINGS_VERSION})"
  fi
  if [ "$(uname -s)" = "Darwin" ] && ls /Library/Managed\ Preferences/com.anthropic.claudecode*.plist >/dev/null 2>&1; then
    report warn "MDM policy" "an MDM profile for Claude Code exists and takes precedence over settings files" \
      "Add the monitor's env and hooks to the MDM profile, or set managedSourcesBehavior to \"merge\" in it"
  fi

  # 3. Claude Code installs
  CLAUDE_VERSIONS="$(find_claude_installs)"
  if [ -z "$CLAUDE_VERSIONS" ]; then
    report warn "Claude Code" "no CLI or IDE extension found for user ${USER:-$(id -un)}" "Install Claude Code, then run: ccm doctor"
  else
    local line label ver old="" summary=""
    while IFS= read -r line; do
      label="${line%|*}"; ver="${line##*|}"
      summary="${summary}${summary:+, }${ver} ${label}"
      version_lt "$ver" "$MIN_CLAUDE_VERSION" && old="${old}${old:+, }${label} ${ver}"
    done <<EOF
$CLAUDE_VERSIONS
EOF
    if [ -n "$old" ]; then
      report warn "Claude Code" "outdated: ${old} (need ${MIN_CLAUDE_VERSION}+)" "Run: claude update   (IDE: update the Claude Code extension)"
    else
      report ok "Claude Code" "$summary"
    fi
  fi

  # 4. Signed-in account
  if load_account; then
    report ok "Claude account" "${ACCOUNT_EMAIL}${ACCOUNT_TIER:+ · $ACCOUNT_TIER}"
  else
    report warn "Claude account" "no signed-in claude.ai account found in $(claude_json_path)" "Open Claude Code and run /login"
  fi

  # 5. Tools
  if command -v curl >/dev/null 2>&1; then report ok "curl" "$(command -v curl)"
  else report fail "curl" "not installed" "Install curl (e.g. sudo apt install curl)"; printf '\n'; return 1; fi

  # 6. Server reachability
  t0="$(date +%s)"
  body="$(curl -sS -m 10 "${CCM_URL}/api/health" -w '\n%{http_code}' 2>&1)"
  t1="$(date +%s)"
  HTTP_STATUS="$(printf '%s' "$body" | tail -n 1)"
  if [ "$HTTP_STATUS" = "200" ]; then
    report ok "Dashboard server" "${CCM_URL} reachable ($((t1 - t0))s)"
  elif [ "$HTTP_STATUS" = "503" ]; then
    report fail "Dashboard server" "${CCM_URL} is up but misconfigured: $(printf '%s' "$body" | sed '$d' | head -c 200)" "Dashboard admin: check environment variables on Vercel"
  else
    report fail "Dashboard server" "cannot reach ${CCM_URL} (HTTP ${HTTP_STATUS})" "Check the network/VPN/proxy, or that the dashboard URL is correct"
  fi

  # 7. Token + 8. telemetry pipeline
  nonce="$(date +%s)$$"
  resp="$(http POST /api/client/check "{\"device_id\":\"$(json_str "$DEVICE_ID")\"}")"
  if [ "$HTTP_STATUS" = "401" ]; then
    report fail "Access token" "rejected by the server" "Token was rotated: re-run the installer from the dashboard's Setup page"
  elif [ "$HTTP_STATUS" = "200" ]; then
    report ok "Access token" "accepted"
    local now_ns="$(date +%s)000000000"
    http POST /v1/logs "{\"resourceLogs\":[{\"resource\":{\"attributes\":[{\"key\":\"ccm.device\",\"value\":{\"stringValue\":\"$(json_str "$DEVICE_ID")\"}},{\"key\":\"dev.name\",\"value\":{\"stringValue\":\"$(json_str "$DEV_NAME")\"}}]},\"scopeLogs\":[{\"logRecords\":[{\"timeUnixNano\":\"${now_ns}\",\"body\":{\"stringValue\":\"ccm.install_check\"},\"attributes\":[{\"key\":\"event.name\",\"value\":{\"stringValue\":\"ccm.install_check\"}},{\"key\":\"ccm.nonce\",\"value\":{\"stringValue\":\"${nonce}\"}}]}]}]}]}" >/dev/null
    if [ "$HTTP_STATUS" = "200" ]; then
      resp="$(http POST /api/client/check "{\"device_id\":\"$(json_str "$DEVICE_ID")\",\"nonce\":\"${nonce}\"}")"
      found="$(printf '%s' "$resp" | grep -o '"nonce_found"[[:space:]]*:[[:space:]]*true')"
      if [ -n "$found" ]; then report ok "Telemetry pipeline" "test event stored"
      else report fail "Telemetry pipeline" "test event accepted but not stored" "Dashboard admin: check the database (npm run db:setup)"; fi
    else
      report fail "Telemetry pipeline" "ingest endpoint returned HTTP ${HTTP_STATUS}" "Dashboard admin: check server logs on Vercel"
    fi
  else
    report fail "Access token" "check endpoint returned HTTP ${HTTP_STATUS}" "Check the dashboard URL and that the deployment is up"
  fi

  # 9. Status line forwarding
  sl_status="$(forward_statusline "{\"session_id\":\"ccm-doctor-${nonce}\",\"version\":\"doctor\",\"model\":{\"display_name\":\"doctor\"}}" "doctor" sync)"
  if [ "$sl_status" = "200" ]; then report ok "Status line" "limit forwarding works"
  else report fail "Status line" "forwarding returned HTTP ${sl_status:-000}" "Check the access token and server status above"; fi

  # 10. Recent activity from this device
  last_at="$(json_field "$resp" last_event_at)"
  last_name="$(json_field "$resp" last_event_name)"
  if [ -n "$last_at" ]; then
    report ok "Recent activity" "last Claude Code event: ${last_name} at ${last_at}"
  else
    report warn "Recent activity" "no Claude Code activity from this device yet" \
      "Restart open Claude Code sessions / VS Code windows, send a message; it appears within ~10s"
  fi

  printf '\n  %s%d passed%s' "$C_OK" "$N_OK" "$C_RESET"
  [ "$N_WARN" -gt 0 ] && printf ' · %s%d warning(s)%s' "$C_WARN" "$N_WARN" "$C_RESET"
  [ "$N_FAIL" -gt 0 ] && printf ' · %s%d failed%s' "$C_FAIL" "$N_FAIL" "$C_RESET"
  printf '\n\n'

  heartbeat "{\"ran_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"ok\":${N_OK},\"warn\":${N_WARN},\"fail\":${N_FAIL},\"items\":[${CHECKS_JSON}]}" >/dev/null 2>&1
  [ "$N_FAIL" -eq 0 ]
}

cmd_update() {
  load_config || { echo "Not installed (config missing at ${CONF})."; exit 1; }
  local v
  v="$(self_update force)"
  if [ -n "$v" ]; then echo "Agent updated to v${v} (${STATE_DIR}/agent/ccm.sh)."
  else echo "Update failed: could not download the agent from ${CCM_URL}."; exit 1; fi
}

cmd_uninstall() {
  if [ "$(id -u)" != "0" ]; then echo "Run with sudo: sudo ccm uninstall"; exit 1; fi
  load_config >/dev/null 2>&1
  if [ -n "$SETTINGS_FILE" ] && grep -q "CCM_SETTINGS_VERSION" "$SETTINGS_FILE" 2>/dev/null; then
    rm -f "$SETTINGS_FILE" && echo "Removed ${SETTINGS_FILE}"
  fi
  [ -L /usr/local/bin/ccm ] && rm -f /usr/local/bin/ccm
  rm -rf "$CCM_INSTALL_DIR" && echo "Removed ${CCM_INSTALL_DIR}"
  echo "Uninstalled. Per-user state in ~/.ccm can be deleted by each user."
}

case "${1:-}" in
  statusline) cmd_statusline ;;
  hook) cmd_hook ;;
  doctor) cmd_doctor ;;
  update) cmd_update ;;
  uninstall) cmd_uninstall ;;
  version|--version|-v) echo "ccm agent v${CCM_AGENT_VERSION}" ;;
  *) echo "Usage: ccm {doctor|update|version|uninstall}"; exit 2 ;;
esac
