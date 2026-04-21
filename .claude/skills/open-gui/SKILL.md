---
name: open-gui
description: |
  Start the piper-draw dev server (Vite frontend + FastAPI backend) and open
  the GUI in the default browser. Use when the user says "open the gui",
  "open the website", "launch the app", "start the dev server", or similar.
  Handles Node version selection via nvm, dependency install, and port cleanup.
---

# /open-gui — Launch the piper-draw GUI

Start both dev servers (Vite on :5173, uvicorn on :8000) and open the frontend
in a browser.

## Step 1: Check if it's already running

```bash
if curl -sf http://localhost:5173/ >/dev/null 2>&1; then
  echo "ALREADY_RUNNING"
else
  echo "NEEDS_START"
fi
```

If `ALREADY_RUNNING`, skip to Step 5 (open the browser).

## Step 2: Ensure Node 22 is active

The frontend toolchain (Vite 8, rolldown) requires Node 20.19+/22+. Node 16
will silently install broken `node_modules` (missing
`@rolldown/binding-darwin-arm64`). If nvm is installed, switch to 22.

```bash
source ~/.nvm/nvm.sh 2>/dev/null && nvm use 22 >/dev/null && node --version
```

If the user doesn't have nvm or Node 22, tell them: "This project needs Node
20.19+ or 22+. You currently have $(node --version). Install Node 22 (e.g.
`brew install node@22` or `nvm install 22`) and re-run."

## Step 3: Install frontend deps if missing or stale

```bash
cd /Users/pderks/conductor/workspaces/piper-draw/kathmandu/piper_draw/gui
if [ ! -d node_modules ] || [ ! -d node_modules/@rolldown/binding-darwin-arm64 ]; then
  echo "Installing frontend deps on $(node --version)..."
  rm -rf node_modules package-lock.json
  npm install
else
  echo "Deps OK"
fi
```

The `@rolldown/binding-darwin-arm64` check catches the common failure mode
where deps were installed on Node 16 and the native binary was skipped.

## Step 4: Clear stale processes and start dev server

```bash
# Free the ports in case a previous run crashed
lsof -ti:5173 | xargs -r kill -9 2>/dev/null || true
lsof -ti:8000 | xargs -r kill -9 2>/dev/null || true
```

Then start the dev server in the background using the Bash tool with
`run_in_background: true`:

```bash
cd /Users/pderks/conductor/workspaces/piper-draw/kathmandu/piper_draw/gui
source ~/.nvm/nvm.sh 2>/dev/null && nvm use 22 >/dev/null
npm run dev
```

Wait ~10 seconds, then read the task output file and confirm both of these
appear:
- `VITE v... ready` (frontend)
- `Uvicorn running on http://127.0.0.1:8000` (backend)

If either is missing, read the output, report the error, and stop.

## Step 5: Open the browser

```bash
open http://localhost:5173/
```

Tell the user:
- Frontend: http://localhost:5173/
- Backend: http://127.0.0.1:8000
- The dev server is running in the background. It will hot-reload on file
  changes. Kill it with `lsof -ti:5173,8000 | xargs kill` when done.
