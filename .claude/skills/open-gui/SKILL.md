---
name: open-gui
description: |
  Start the piper-draw dev server (Vite frontend + FastAPI backend) and open
  the GUI in the default browser. Use when the user says "open the gui",
  "open the website", "launch the app", "start the dev server", or similar.
  Handles Node version selection via nvm (if present), dependency install,
  and port cleanup. Cross-platform (macOS / Linux, arm64 / x64).
---

# /open-gui — Launch the piper-draw GUI

Start both dev servers (Vite on :5173, uvicorn on :8000) and open the frontend
in a browser.

## Step 0: Locate the gui directory

Every subsequent step runs from this dir. Never hardcode absolute paths —
derive from git so the skill works for every contributor.

```bash
GUI_DIR="$(git rev-parse --show-toplevel)/piper_draw/gui"
cd "$GUI_DIR"
```

If `git rev-parse` fails, the user is outside the repo — tell them to `cd`
into the piper-draw checkout and re-run.

## Step 1: Check if it's already running

```bash
if curl -sf http://localhost:5173/ >/dev/null 2>&1; then
  echo "ALREADY_RUNNING"
else
  echo "NEEDS_START"
fi
```

If `ALREADY_RUNNING`, skip to Step 5.

## Step 2: Ensure Node 22+ is active

The frontend toolchain requires Node >=22 (`camera-controls@3.x`,
`rolldown`). With `engine-strict=true` in `.npmrc`, `npm install` hard-fails
on older versions.

Try nvm first, fall back to the system Node:

```bash
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  source "$HOME/.nvm/nvm.sh"
  # Honor the repo's .nvmrc (pinned to 22)
  nvm use >/dev/null 2>&1 || nvm use 22 >/dev/null 2>&1 || true
fi
node --version
```

If the active Node is <22, stop and tell the user:

> This project needs Node >=22. You have `$(node --version)`. Install Node 22:
> - nvm: `nvm install 22 && nvm use 22`
> - brew (macOS): `brew install node@22 && brew link --overwrite node@22`
> - apt (Linux): follow https://github.com/nodesource/distributions

## Step 3: Install frontend deps if missing or stale

The rolldown native binary is platform-specific. Detect by glob (works on
darwin-arm64, darwin-x64, linux-x64, linux-arm64) instead of a fixed name.

```bash
needs_install=0
if [ ! -d node_modules ]; then
  needs_install=1
elif ! ls node_modules/@rolldown/binding-* >/dev/null 2>&1; then
  # Deps installed under a Node version that skipped the native binary
  needs_install=1
fi

if [ "$needs_install" = 1 ]; then
  echo "Installing frontend deps on $(node --version)..."
  rm -rf node_modules
  npm ci || npm install
else
  echo "Deps OK"
fi
```

Prefer `npm ci` when the lockfile is present so the install matches the
committed tree exactly; fall back to `npm install` only if `npm ci` rejects
(e.g. missing lockfile).

## Step 4: Clear stale processes and start dev server

```bash
# Portable lsof kill (the -r flag on xargs is GNU-only)
for port in 5173 8000; do
  pids=$(lsof -ti:$port 2>/dev/null || true)
  [ -n "$pids" ] && kill -9 $pids 2>/dev/null || true
done
```

Start the dev server with the Bash tool using `run_in_background: true`:

```bash
cd "$(git rev-parse --show-toplevel)/piper_draw/gui"
[ -s "$HOME/.nvm/nvm.sh" ] && source "$HOME/.nvm/nvm.sh" && nvm use >/dev/null 2>&1
npm run dev
```

Wait ~10 seconds, then read the background task output file and confirm
both lines appear:
- `VITE v... ready` (frontend)
- `Uvicorn running on http://127.0.0.1:8000` (backend)

If either is missing, read the full output, report the error, and stop.

## Step 5: Open the browser

Pick the right command for the platform:

```bash
case "$(uname)" in
  Darwin) open http://localhost:5173/ ;;
  Linux)  xdg-open http://localhost:5173/ >/dev/null 2>&1 || \
          echo "Open http://localhost:5173/ manually" ;;
  *)      echo "Open http://localhost:5173/ manually" ;;
esac
```

Tell the user:
- Frontend: http://localhost:5173/
- Backend: http://127.0.0.1:8000
- Dev server runs in the background with hot reload. Kill it with
  `lsof -ti:5173,8000 | xargs kill` when done.
