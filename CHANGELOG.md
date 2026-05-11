# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
a four-digit version: `MAJOR.MINOR.PATCH.MICRO`.

## [Unreleased]

## [0.2.3.0] - 2026-05-11

### Added
- **Bgraph import/export** ([#309](https://github.com/Walrus-Computing/piper-draw/issues/309)).
  Piper-draw now reads and writes TQEC's `.bgraph` plain-text format
  (`tqec.interop.bgraph`, [tqec/tqec#864](https://github.com/tqec/tqec/pull/864)).
  File ▾ gains `Import ▸` and `Export ▸` side submenus that contain all
  file-format operations (`.dae` and `.bgraph` together — see "Changed" below).
  - **Unified bgraph modal**: `Load bgraph…` and `Insert bgraph…` open the
    same modal — choose a file or paste a bgraph string, then submit. Replaces
    the earlier three-item layout (Load .bgraph / Insert .bgraph / Paste
    bgraph). The (action × source) grid is now fully covered: file-or-paste
    can be combined with replace-or-insert.
  - **Browse examples…** replaces both the legacy `Templates ▸` menu and the
    bgraph-specific `Load example…`. Each row has Load (replace) and `+`
    (insert) buttons. Backed by `.bgraph` exclusively; the `.dae` template
    library is gone (see "Removed").
  - **Paste bgraph** opens a centered modal — paste a bgraph straight from a
    TQEC notebook, ⌘/Ctrl+Enter to import. 5 MB cap with inline size readout.
  - **Load example…** opens a floating panel with 7 pre-bundled TQEC graphs
    (CNOT, CZ, Memory, Stability, Move + Rotation, Three CNOTs, Steane
    Encoding). One click to load any of them.
  - **Drag-and-drop** a `.bgraph` (or `.dae`) onto the canvas to load it.
    Dashed-border overlay confirms the canvas is accepting the drop.
  - **Lossless TQEC-data round-trip** — cubes, pipes, kinds, port labels, and
    Y-cubes all survive piper-draw → bgraph → piper-draw, verified by a CI
    round-trip test that builds a 9-block scene with ports and Y-cubes,
    serializes, re-imports, and asserts block-by-block equality.
  - **Strict export validation.** Every bgraph export now runs
    `BlockGraph.validate()` before writing — the same graph-level checks
    `/api/validate` runs interactively. A scene with mismatched cube/pipe
    colors, dangling pipes, or Y-cube axis conflicts is rejected at export
    time with a 400 `bgraph_invalid_graph` error and the field-pointed
    TQEC message. Pass `force=true` in the request to snapshot an
    in-progress scene anyway. Tests added: every bundled gallery example,
    when exported through piper-draw, round-trips via TQEC's own
    `BlockGraph.from_bgraph` + `graph.validate()` — end-to-end proof that
    piper-draw exports are valid TQEC input.
  - Sandwich-cube ambiguity (e.g. `XZX` vs `ZZX` for cubes between two
    same-axis pipes) is normalized to the first valid `CUBE_TYPES` entry on
    import — same rule the DAE importer uses — and a `Normalized N cube types`
    toast tells the user when this happens.

### Changed
- **Ports panel — duplicate-label rejection is now loud.** Editing a port to a
  label already used by another port still blocks the change (existing
  behavior) but now also surfaces a `Duplicate port label '<l>'; pick a unique
  label.` error toast so the user sees the rejection instead of the field
  silently snapping back.
- **File ▾ menu reorganized.** Top-level entries went from a flat list of
  12 items to 5: `Import ▸`, `Export ▸`, Share link, Screenshot, Clear all.
  Grouping by intent (open vs save) keeps the menu scannable as more file
  formats land. The existing `Import…` / `Insert…` / `Export` labels are now
  explicit about format (`Load .dae…`, `Insert .dae…`, `Export .dae`) since
  they sit next to bgraph siblings.

### Removed
- **`.dae` template library** (`gui/public/templates/`, `scripts/generate_templates.py`,
  `gui/src/utils/templates.ts`). The five bundled `.dae` templates (CNOT, CZ,
  move + rotation, three CNOTs, Steane encoding) duplicated the new bgraph
  examples — same scenes, different format, same `tqec.gallery` source. Use
  `Browse examples…` instead; the bgraph gallery includes those five plus
  memory and stability.
## [0.2.2.0] - 2026-05-08

### Fixed
- Pipe types now reconcile across a shared port. Drag-placing a pipe whose
  endpoint lands at a port already shared with another pipe no longer
  silently fails: when the two pipes' bases at the port are incompatible,
  the existing pipe auto-retypes (Hadamard toggle or variant swap) so the
  port can promote to a canonical cube. Same fix applies to the keyboard
  build path (W/A/S/D extending into a port with attached pipes) and to the
  R-key cube cycle (when retyping a cube would invalidate a pipe across a
  port). When no chain of retypes can resolve the conflict, the placement
  is rejected and the existing red-ghost UX surfaces the reason. Far cubes
  invalidated by a pipe retype cascade automatically. Undo/redo reverts
  the entire chain (anchor + pipe retypes + cascaded cubes) atomically.
  Issue #307.

## [0.2.1.4] - 2026-05-07

### Fixed
- A port placed at z=0 no longer flickers on its bottom face as the camera
  orbits. The visible checkerboard grid (lifted by Y=0.001 to clear cube
  bottom faces) and the port's bottom face at Y=0 are coplanar transparents,
  so Three.js's centroid-based transparent sort would flip their draw order
  frame-to-frame as the orbit target moved past the port. The grid now
  renders with `renderOrder=-1`, forcing it to draw before all other
  transparents — port bottom faces always blend over the grid, regardless
  of camera angle.

## [0.2.1.3] - 2026-05-07

### Changed
- Camera controls renamed and rewired: the Settings radio reads "Drag to orbit"
  (was "Drag to rotate"), and middle-drag and right-drag are now the opposite
  gesture from the primary drag — both pan when LEFT orbits, and both orbit
  when LEFT pans. (Same effect as Shift+drag.) Iso elevation views are
  unchanged (LEFT pans, middle still zooms). Help panel copy and the Settings
  hint text are updated to match.

## [0.2.1.2] - 2026-05-07

### Fixed
- Placing a pipe on the bottom face of a cube from a below-the-floor camera
  no longer drops a misleading ghost (or click) at z=0. With the camera
  rotated under the XY plane, the invisible floor was silently consuming
  pointer-moves and clicks that targeted blocks above, dropping the hover
  preview onto z=0 even though the cursor was clearly on a cube. The grid
  plane now bows out of placement-tool hovers and clicks when the camera
  is below it; pointer/paste tools are unaffected so deselect-on-empty-
  click and clipboard commits still respond from any angle.

## [0.2.1.1] - 2026-05-07

### Fixed
- Ctrl+A in Select mode now also selects every visible port — both manually
  placed port markers and the implicit ports at open pipe endpoints. They
  pulse with the selection highlight just like marquee-selected ports, and
  a follow-on Backspace removes them along with the rest of the selection.
  Closes #300.

## [0.2.1.0] - 2026-05-07

### Changed
- Free Build mode (which lets you place cubes and pipes through colour
  mismatched intermediate states) is now a top-level toolbar button instead
  of a hidden checkbox in Settings, with a clearly painted ON state so the
  relaxed-rules mode is unmistakable while it's active. The duplicate
  "Ignore color rules" entry in the Settings menu has been removed.
- When a placement is rejected because of a colour mismatch, the red toast
  now offers an inline "Turn on Free Build" link that toggles the mode and
  dismisses the warning in one click. Rejections that Free Build cannot
  bypass (overlap, invalid position) keep the original toast with no hint.

## [0.2.0.1] - 2026-05-07

### Fixed
- Placing a pipe next to a cube no longer fails when the cube's current type
  doesn't accept the pipe's basis but a different canonical type would. The
  cube now retypes itself (and Hadamard-toggles any neighbour pipes the new
  cube type forces) on click, then the pipe lands. The hover ghost previews
  the success in green instead of red. Strict TQEC mode only — free-build
  was already permissive. The cube retype + pipe add are recorded as two
  separate undo entries so a second undo press restores the cube's original
  type. Closes #292.

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
