# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
a four-digit version: `MAJOR.MINOR.PATCH.MICRO`.

## [Unreleased]

## [0.2.0.0] - 2026-05-07

### Added
- Click any port (white pulsing ghost cube at an open pipe endpoint) in
  Keyboard Build mode to move the build cursor there. Previously only cubes
  were clickable in build mode, so ports above the floor were hard to reach
  — keyboard navigation up the Z axis was the only option. Closes #293.
- New keyboard shortcut in Keyboard Build mode: press `P` to jump the
  cursor to the next port and `Shift+P` to jump to the previous one. Cycle
  order matches the per-port number labels and the Ports table. Both
  bindings are rebindable in Settings → Keybinds → Build.

## [0.1.5.1] - 2026-05-07

### Changed
- Default camera navigation is now "Drag to rotate" (orbit) instead of "Drag
  to pan". Returning users get a one-time reset to the new default (Zustand
  persist had stored the old default in every prior user's localStorage, so
  a plain default flip would never have reached them); users who actively
  preferred pan can re-pick it in Settings → Navigation style. Middle-click
  drag now always orbits the model in perspective view, regardless of the
  Navigation style setting. Mouse-wheel zoom and the Settings → Navigation
  style toggle are unchanged.

## [0.1.5.0] - 2026-05-07

### Fixed
- Computing flows for a small diagram now returns in milliseconds instead
  of taking ~2 seconds on the first click after each backend reload. The
  first call to `tqec`'s `find_correlation_surfaces` in any Python process
  paid a process-global lazy-init tax inside `tqec` / `pyzx`; with
  `uvicorn --reload` that reset on every save. The FastAPI app now warms
  it once at startup so the first `/api/flows` POST is fast.

## [0.1.4.0] - 2026-05-07

### Fixed
- Opening the Flows or ZX panel for the first time after a page load no
  longer blanks the entire 3D scene (background, blocks, lights) for a
  few frames. The port-label text used to load its font lazily on first
  mount, which briefly hid every sibling in the canvas with it.
  Closes #278.

## [0.1.3.7] - 2026-05-04

### Fixed
- Cube edge lines no longer flicker between faces when the camera is still.
  Three.js's `logarithmicDepthBuffer` was silently disabling the polygon
  offset that keeps the black edge wireframe rendering in front of cube
  faces, so depth comparisons landed at the precision boundary and flipped
  frame-to-frame. Removed the log depth buffer (the scene's depth range
  doesn't need it) and inflated edge corners by a sub-pixel offset as a
  belt-and-braces guard against future renderer changes.
  Closes #274.

## [0.1.3.6] - 2026-05-04

### Fixed
- Clicking the model from a below-the-floor camera now works. With the camera
  rotated underneath the XY plane (looking up at the model so you can build
  downward), the invisible ground plane's back face raycasts closer than the
  blocks and used to hijack every click — placement tools landed a new block
  on the floor instead of running face-adjacent placement, and Keyboard Build
  mode moved the cursor to the floor instead of to the clicked cube. Edit-mode
  click + pointer-move and Build-mode click now pass through to the block
  handler whenever the click ray also hits a block, regardless of the armed
  tool.
- No more dead zones in flow-viz and Y-defect modes. Hovering over a flow
  surface or a Y-defect cylinder used to leave the placement / paste ghost
  frozen at the previous cell because the overlay meshes lacked
  `raycast={noRaycast}` and had no event handlers, so the widened plane
  pass-through silently dropped pointer-move updates. Both overlays now opt
  out of raycasting per the project's decorative-mesh convention.

## [0.1.3.5] - 2026-05-04

### Fixed
- Toolbar height no longer flickers when the mouse moves toward it in a
  narrow window. Sub-pixel oscillation in the toolbar's natural width — from
  the live FPS counter and hover-driven Position display — was retriggering
  a `transform: scale(...)` recompute every frame. The viewport-fit hook now
  ignores scale changes below a 0.5% threshold, which still reacts to real
  fit changes (mode switches, selection inspector appearing) but absorbs
  the text-width noise.
  Closes #280.

## [0.1.3.3] - 2026-05-04

### Changed
- Reduced camera momentum in both perspective and iso viewports. Orbit / pan /
  zoom now settle in ~250ms after mouse release instead of ~700ms (drei
  `dampingFactor` 0.05 → 0.2). Adjust-then-click workflows feel responsive
  without losing the smoothing.

## [0.1.3.2] - 2026-05-04

### Fixed
- Y blocks now flip around X, Y, and Z axes (180°). Previously the X-flip and
  Y-flip hotkeys aborted any selection that included a Y cube with the error
  "Y blocks can only rotate around the Z axis." 90° X/Y rotations of Y blocks
  remain rejected because piper-draw does not encode a Y-direction.

## [0.1.3.1] - 2026-05-01

### Changed
- Highlight geometry helper deduplicated. The cube/edge geometry cache used by
  `InvalidBlockHighlights`, `LocatePulseHighlight`, and `SelectionHighlights`
  now lives in `gui/src/components/highlightGeo.ts` and accepts a per-call scale
  factor. Behaviour is identical; this removes ~60 lines of copy-paste.
- ESLint now enforces `max-lines: 600` and `max-lines-per-function: 80`. The six
  hot files (blockStore, types/index, Toolbar, App, ZXPanel, FlowsPanel) plus the
  current per-function offenders are grandfathered until splits land — overrides
  are removed in the same PR that takes a file under threshold.
- CI runs `npm run slop:diff` against the PR base as a warn-only gate. Findings
  surface in logs but do not block merge during the bake-in window (E3 from the
  CEO tech-debt plan).

## [0.1.3.0] - 2026-05-01

### Changed
- Group-toggle hint toasts ("Select 2+ blocks", "mixes grouped and ungrouped",
  "spans multiple groups"), the auto-dissolve toast, and the one-time
  G-keymap migration notice now route through a non-destructive info channel.
  Previously these reused the verify-error channel and silently wiped any
  red invalid-block highlights from an in-progress verify (R7). Info toasts
  appear top-right; the verify-error toast continues to occupy the top
  centre.
- Internal: ephemeral toasts are now dispatched through a shared event bus
  (`gui/src/utils/toastBus.ts`) with `error` and `info` channels. Replaces
  the dynamic-import workaround in `blockStore.ts` that fired toasts a
  microtask later.

## [0.1.2.1] - 2026-05-01

### Added
- Weekly file-size tracker. A new GitHub Actions workflow
  (`.github/workflows/weekly-metrics.yml`) runs every Monday at 09:00 UTC,
  measures the LOC of the six hot files against the CEO tech-debt plan
  targets, and posts a comment on a stable tracking issue. Works as a
  schedule-independent backup to the gstack `/retro` routine, so the trend is
  recorded even when the agent run is skipped or fails (per Codex #9 finding).

## [0.1.2.0] - 2026-05-01

### Added
- `ARCHITECTURE.md` at the repo root: navigation map for `gui/src/` with the
  top-level data flow, module map, "files NOT to grow" list with current LOC
  and target sizes, and a decision tree for where to add new code. Future
  module-boundary changes should update it.
- `## File-size discipline` section in `CLAUDE.md` covering the >500-LOC
  yellow-line rule, the do-not-grow list of hot files, and the Block-mutation
  spread invariant. Linked to active learnings so the source of truth stays
  in the learnings store.
- `.github/PULL_REQUEST_TEMPLATE.md` with a checklist item that asks
  contributors to update `ARCHITECTURE.md` when module boundaries change
  (or include `[arch-noop]` in a commit message to opt out).
- `.github/workflows/architecture-md-check.yml` — CI check that fails PRs
  touching `gui/src/stores/` or `gui/src/utils/` without updating
  `ARCHITECTURE.md`, with the same `[arch-noop]` opt-out.

## [0.1.1.0] - 2026-05-01

### Changed
- Defensive error-handling cleanup across browser-storage and pointer-capture
  call sites. Catches that previously swallowed errors silently now bind the
  error variable explicitly (`catch (err) { /* reason */ void err; }`), making
  intentional swallows grep-able and consistent. No user-visible behavior
  changes.

### Fixed
- `readShowYDefects` and the `decompressWithCap` URL-share fallback now log
  failures via `console.debug` before falling back to the safe default,
  improving debuggability without surfacing errors to end users.

## [0.1.0.0] - 2026-04-30

### Added
- Begin tracking releases in `VERSION` and `CHANGELOG.md`. Prior changes are in
  the git history and merged PRs (#231-#259).
