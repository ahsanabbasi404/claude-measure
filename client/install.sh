#!/usr/bin/env bash
# Claude Code usage monitor installer for macOS, Linux and WSL.
#
#   curl -fsSL __CCM_URL__/install.sh | sudo bash -s -- --token <TOKEN> [--name "Full Name"] [--team team]
#
# Safe to re-run: keeps the device id, name and team of an existing install unless overridden.
set -u

CCM_URL="__CCM_URL__"
TOKEN="" NAME="" TEAM="" ASSUME_YES=0
PREFIX="${CCM_TEST_PREFIX:-}"   # test hook: redirects every system path under this directory

while [ $# -gt 0 ]; do
  case "$1" in
    --token) TOKEN="${2:-}"; shift 2 ;;
    --name) NAME="${2:-}"; shift 2 ;;
    --team) TEAM="${2:-}"; shift 2 ;;
    --url) CCM_URL="${2:-}"; shift 2 ;;
    -y|--yes) ASSUME_YES=1; shift ;;
    *) echo "Unknown option: $1"; exit 2 ;;
  esac
done
CCM_URL="${CCM_URL%/}"

if [ -t 1 ]; then
  B=$'\033[1m' D=$'\033[2m' G=$'\033[32m' Y=$'\033[33m' R=$'\033[31m' X=$'\033[0m'
else
  B="" D="" G="" Y="" R="" X=""
fi
step() { printf '%s›%s %s\n' "$D" "$X" "$1"; }
ok() { printf '  %s✓%s %s\n' "$G" "$X" "$1"; }
warn() { printf '  %s!%s %s\n' "$Y" "$X" "$1"; }
die() {
  printf '\n  %s✗ %s%s\n' "$R" "$1" "$X"
  [ -n "${2:-}" ] && printf '    %s→ %s%s\n' "$D" "$2" "$X"
  printf '\n'
  exit 1
}

printf '\n%sClaude Code usage monitor · installer%s\n%s%s%s\n\n' "$B" "$X" "$D" "$CCM_URL" "$X"

# ---------------------------------------------------------------- environment
if [ -z "$PREFIX" ] && [ "$(id -u)" != "0" ]; then
  die "Administrator rights are required to write Claude Code's managed settings." \
      "Re-run with sudo: curl -fsSL ${CCM_URL}/install.sh | sudo bash -s -- --token <TOKEN>"
fi
command -v curl >/dev/null 2>&1 || die "curl is not installed." "Install curl (e.g. sudo apt install curl) and re-run."

case "${CCM_TEST_OS:-$(uname -s)}" in
  Darwin)
    SETTINGS_DIR="$PREFIX/Library/Application Support/ClaudeCode"
    INSTALL_DIR="$SETTINGS_DIR/ccm" ;;
  Linux)
    SETTINGS_DIR="$PREFIX/etc/claude-code"
    INSTALL_DIR="$PREFIX/opt/ccm" ;;
  *) die "Unsupported OS: $(uname -s)." "On Windows use the PowerShell installer from the dashboard Setup page." ;;
esac
BIN_DIR="$PREFIX/usr/local/bin"

REAL_USER="${SUDO_USER:-$(id -un)}"
if [ -n "$PREFIX" ]; then REAL_HOME="$HOME"
elif [ "$(uname -s)" = "Darwin" ]; then REAL_HOME="$(dscl . -read "/Users/$REAL_USER" NFSHomeDirectory 2>/dev/null | awk '{print $2}')"
else REAL_HOME="$(getent passwd "$REAL_USER" 2>/dev/null | cut -d: -f6)"; fi
[ -n "$REAL_HOME" ] || REAL_HOME="$(eval echo "~$REAL_USER")"

# ---------------------------------------------------------------- previous install
PREV_DEVICE="" PREV_NAME="" PREV_TEAM="" PREV_TOKEN="" PREV_SETTINGS="" PREV_CHAIN=""
if [ -r "$INSTALL_DIR/config" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    k="${line%%=*}"; v="${line#*=}"
    case "$k" in
      DEVICE_ID) PREV_DEVICE="$v" ;; DEV_NAME) PREV_NAME="$v" ;; TEAM) PREV_TEAM="$v" ;;
      CCM_TOKEN) PREV_TOKEN="$v" ;; SETTINGS_FILE) PREV_SETTINGS="$v" ;; CHAIN_STATUSLINE_B64) PREV_CHAIN="$v" ;;
    esac
  done < "$INSTALL_DIR/config"
  step "Existing install found for ${PREV_NAME:-unknown}; updating it."
fi

# python3 is optional; the Microsoft Store stub on Windows exists but cannot run code.
have_python() { python3 -c 'import json' >/dev/null 2>&1; }

ask() {
  # ask VAR "Prompt" [default]
  local __var="$1" __prompt="$2" __default="${3:-}" __reply=""
  if [ "$ASSUME_YES" = "1" ] || [ ! -r /dev/tty ]; then
    printf -v "$__var" '%s' "$__default"; return
  fi
  if [ -n "$__default" ]; then printf '  %s [%s]: ' "$__prompt" "$__default" > /dev/tty
  else printf '  %s: ' "$__prompt" > /dev/tty; fi
  IFS= read -r __reply < /dev/tty
  printf -v "$__var" '%s' "${__reply:-$__default}"
}

[ -n "$TOKEN" ] || TOKEN="$PREV_TOKEN"
[ -n "$TOKEN" ] || ask TOKEN "Access token (from the dashboard Setup page)"
[ -n "$TOKEN" ] || die "No access token given." "Pass --token <TOKEN> (copy the command from the dashboard Setup page)."

[ -n "$NAME" ] || ask NAME "Your name, as shown on the dashboard" "$PREV_NAME"
NAME="$(printf '%s' "$NAME" | tr -d '\r\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
[ -n "$NAME" ] || die "A name is required." "Pass --name \"Full Name\"."
[ -n "$TEAM" ] || ask TEAM "Team (optional)" "$PREV_TEAM"
TEAM="$(printf '%s' "$TEAM" | tr -d '\r\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"

if [ -n "$PREV_DEVICE" ]; then DEVICE_ID="$PREV_DEVICE"
elif command -v uuidgen >/dev/null 2>&1; then DEVICE_ID="$(uuidgen | tr 'A-Z' 'a-z')"
elif [ -r /proc/sys/kernel/random/uuid ]; then DEVICE_ID="$(cat /proc/sys/kernel/random/uuid)"
else DEVICE_ID="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"; fi
HOST_NAME="$(hostname 2>/dev/null || uname -n)"
printf '\n'

# ---------------------------------------------------------------- server + token
step "Checking the dashboard server"
health="$(curl -sS -m 15 "$CCM_URL/api/health" -w '\n%{http_code}' 2>&1)"
code="$(printf '%s' "$health" | tail -n 1)"
case "$code" in
  200) ok "Server reachable" ;;
  503) die "The dashboard server is misconfigured: $(printf '%s' "$health" | sed '$d')" "Dashboard admin: set the missing environment variables on Vercel." ;;
  *) die "Cannot reach $CCM_URL (HTTP $code)." "Check the URL, network, VPN or proxy settings." ;;
esac
code="$(curl -sS -m 15 -o /dev/null -w '%{http_code}' -X POST "$CCM_URL/api/client/check" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}' 2>/dev/null)"
[ "$code" = "200" ] || die "The access token was rejected (HTTP $code)." "Copy the current install command from the dashboard Setup page."
ok "Access token accepted"

# ---------------------------------------------------------------- agent
step "Installing the agent"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
curl -sS -m 30 -D "$TMP/h" -o "$TMP/ccm.sh" -H "Authorization: Bearer $TOKEN" "$CCM_URL/api/client/agent?platform=posix" \
  || die "Could not download the agent." "Check the network and re-run."
want="$(tr -d '\r' < "$TMP/h" | grep -i '^x-ccm-sha256:' | sed 's/^[^:]*:[[:space:]]*//')"
if command -v sha256sum >/dev/null 2>&1; then got="$(sha256sum "$TMP/ccm.sh" | cut -d' ' -f1)"; else got="$(shasum -a 256 "$TMP/ccm.sh" | cut -d' ' -f1)"; fi
[ -n "$want" ] && [ "$want" = "$got" ] || die "Agent download failed verification." "Re-run the installer; if it persists, check for a proxy rewriting downloads."
mkdir -p "$INSTALL_DIR" "$BIN_DIR" || die "Cannot create $INSTALL_DIR."
install -m 755 "$TMP/ccm.sh" "$INSTALL_DIR/ccm.sh" || die "Cannot write $INSTALL_DIR/ccm.sh."
printf '#!/usr/bin/env bash\nexec bash "%s/ccm.sh" "$@"\n' "$INSTALL_DIR" > "$BIN_DIR/ccm" && chmod 755 "$BIN_DIR/ccm"
ok "Agent v$(sed -n 's/^CCM_AGENT_VERSION=//p' "$INSTALL_DIR/ccm.sh") → $INSTALL_DIR (command: ccm)"

# ---------------------------------------------------------------- existing status line
CHAIN_B64="$PREV_CHAIN"
USER_SETTINGS="$REAL_HOME/.claude/settings.json"
if [ -z "$CHAIN_B64" ] && [ -f "$USER_SETTINGS" ] && grep -q '"statusLine"' "$USER_SETTINGS"; then
  if have_python; then
    chain="$(python3 -c 'import json,sys
try:
  s=json.load(sys.stdin).get("statusLine") or {}
  c=s.get("command","") if s.get("type","command")=="command" else ""
  print(c if "ccm.sh" not in c else "")
except Exception: pass' < "$USER_SETTINGS")"
    if [ -n "$chain" ]; then
      CHAIN_B64="$(printf '%s' "$chain" | base64 | tr -d '\n')"
      ok "Your existing status line is kept and shown above the usage line"
    fi
  else
    warn "You have a custom status line; install python3 and re-run to keep it next to the usage line"
  fi
fi

# ---------------------------------------------------------------- Claude Code settings
step "Writing Claude Code managed settings"
MAIN="$SETTINGS_DIR/managed-settings.json"
if [ -n "$PREV_SETTINGS" ] && [ -f "$PREV_SETTINGS" ] && grep -q CCM_SETTINGS_VERSION "$PREV_SETTINGS"; then
  SETTINGS_FILE="$PREV_SETTINGS"
elif [ ! -f "$MAIN" ] || grep -q CCM_SETTINGS_VERSION "$MAIN"; then
  SETTINGS_FILE="$MAIN"
else
  # The organization already has a managed-settings.json: add a drop-in instead of touching it.
  SETTINGS_FILE="$SETTINGS_DIR/managed-settings.d/50-usage-monitor.json"
fi
mkdir -p "$(dirname "$SETTINGS_FILE")" || die "Cannot create $(dirname "$SETTINGS_FILE")."
code="$(curl -sS -m 15 -G -D "$TMP/sh" -o "$TMP/settings.json" -w '%{http_code}' -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "platform=posix" --data-urlencode "install_dir=$INSTALL_DIR" \
  --data-urlencode "device_id=$DEVICE_ID" --data-urlencode "dev_name=$NAME" \
  --data-urlencode "team=$TEAM" --data-urlencode "host_name=$HOST_NAME" \
  "$CCM_URL/api/client/settings" 2>/dev/null)"
[ "$code" = "200" ] && [ -s "$TMP/settings.json" ] || die "Could not generate settings (HTTP $code)." "Re-run the installer."
if have_python; then
  python3 -c 'import json,sys; json.load(sys.stdin)' < "$TMP/settings.json" 2>/dev/null || die "Generated settings are not valid JSON." "Re-run the installer."
fi
SETTINGS_VERSION="$(tr -d '\r' < "$TMP/sh" | grep -i '^x-ccm-settings-version:' | sed 's/^[^:]*:[[:space:]]*//')"
install -m 644 "$TMP/settings.json" "$SETTINGS_FILE" || die "Cannot write $SETTINGS_FILE."
ok "$SETTINGS_FILE"

umask 022
cat > "$INSTALL_DIR/config" <<EOF
# Claude Code usage monitor. Re-run the installer to change these values.
CCM_URL=$CCM_URL
CCM_TOKEN=$TOKEN
DEVICE_ID=$DEVICE_ID
DEV_NAME=$NAME
TEAM=$TEAM
SETTINGS_FILE=$SETTINGS_FILE
SETTINGS_VERSION=${SETTINGS_VERSION:-1}
AUTO_UPDATE=1
CHAIN_STATUSLINE_B64=$CHAIN_B64
INSTALLED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
chmod 644 "$INSTALL_DIR/config"
ok "Device $DEVICE_ID registered to $NAME${TEAM:+ ($TEAM)}"

# ---------------------------------------------------------------- verify
printf '\n'
step "Running checks"
if [ -z "$PREFIX" ] && [ "$(id -u)" = "0" ] && [ "$REAL_USER" != "root" ]; then
  sudo -u "$REAL_USER" -H bash "$INSTALL_DIR/ccm.sh" doctor
else
  bash "$INSTALL_DIR/ccm.sh" doctor
fi
status=$?

if [ $status -eq 0 ]; then
  printf '%sInstalled.%s Restart Claude Code to apply: exit running %sclaude%s sessions and reload VS Code / Cursor windows.\n' "$G$B" "$X" "$B" "$X"
else
  printf '%sInstalled with problems.%s Fix the items marked ✗ above, then run: %sccm doctor%s\n' "$R$B" "$X" "$B" "$X"
fi
printf '%sRe-check any time with: ccm doctor%s\n\n' "$D" "$X"
exit $status
