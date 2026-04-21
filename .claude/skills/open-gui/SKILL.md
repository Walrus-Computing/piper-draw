---
name: open-gui
description: |
  Start the piper-draw dev server (Vite frontend + FastAPI backend) and open
  the GUI in the default browser. Use when the user says "open the gui",
  "open the website", "launch the app", "start the dev server", or similar.
  Uses per-workspace ports so multiple Conductor workspaces run side by side.
---

# /open-gui — Launch the piper-draw GUI

Run the helper script and print its final line. One bash call, no follow-ups.

```bash
.claude/skills/open-gui/start.sh
```

The script handles everything: derives per-workspace ports, short-circuits if
the server is already up, sources nvm for Node 22, backgrounds `make dev`,
waits for Vite, and opens the browser. On success it prints one line like:

    started in 4s  frontend=http://localhost:5245/  backend=http://127.0.0.1:8072  log=/tmp/open-gui-manama.log

On failure it prints a tail of the log and exits non-zero — relay that to
the user unchanged.
