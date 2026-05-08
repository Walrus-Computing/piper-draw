#!/usr/bin/env bash
# Launch piper-draw dev servers on per-workspace ports, then open the GUI.
# Fast path: if already running, just open the browser.
# Cold path: source nvm, background `make dev`, poll, open.

set -u

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "error: not in a git repo — cd into the piper-draw checkout and retry" >&2
  exit 2
}
WS="$(basename "$ROOT")"
OFFSET=$(( $(printf '%s' "$WS" | cksum | awk '{print $1}') % 100 ))
VITE_PORT=$((5173 + OFFSET))
BACKEND_PORT=$((8000 + OFFSET))
URL="http://localhost:$VITE_PORT/"

open_url() {
  case "$(uname)" in
    Darwin) open "$URL" 2>/dev/null || true ;;
    Linux)  xdg-open "$URL" >/dev/null 2>&1 || echo "open $URL manually" ;;
    *)      echo "open $URL manually" ;;
  esac
}

# Fast path
if curl -sf "$URL" >/dev/null 2>&1; then
  open_url
  echo "already running  frontend=$URL  backend=http://127.0.0.1:$BACKEND_PORT"
  exit 0
fi

# Cold path: source nvm from gui/ (where .nvmrc lives), then make dev in the bg.
cd "$ROOT/gui"
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh"
  nvm use >/dev/null 2>&1 || true
fi
node_major=$(node --version 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/')
if [ -z "${node_major:-}" ] || [ "$node_major" -lt 22 ]; then
  echo "error: need Node 22+, got $(node --version 2>/dev/null || echo none). Try: nvm install 22" >&2
  exit 3
fi

cd "$ROOT"
export VITE_PORT BACKEND_PORT
LOG="/tmp/open-gui-$WS.log"
nohup make dev >"$LOG" 2>&1 </dev/null &
disown 2>/dev/null || true

for i in $(seq 1 30); do
  if curl -sf "$URL" >/dev/null 2>&1; then
    open_url
    echo "started in ${i}s  frontend=$URL  backend=http://127.0.0.1:$BACKEND_PORT  log=$LOG"
    exit 0
  fi
  sleep 1
done

echo "TIMEOUT after 30s. Tail of $LOG:" >&2
tail -30 "$LOG" >&2
exit 1
