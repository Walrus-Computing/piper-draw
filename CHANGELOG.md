# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
a four-digit version: `MAJOR.MINOR.PATCH.MICRO`.

## [Unreleased]

### Added
- **Interactive tutorial.** A hands-on, in-app tour modeled on the neutral-atom editor's click-through tutorial: 13 steps covering cubes, pipes, type cycling, Keyboard Build, Verify, the CNOT template, copy/paste, stabilizer flows, ZX analysis, and share links. Every step is a real edit on the live scene — completion is detected from document state (counts vs. a per-step, undo-aware baseline), never by trusting a "Next" click. The card shows progress, pulses the relevant toolbar controls, offers Skip per step, and remembers completion/dismissal in localStorage. Auto-offers once after the first-visit intro closes; restart anytime from the ? help panel.

## [0.7.2.0] - 2026-08-10

### Fixed
- **Copy → paste of a selection whose edge is a pipe now works.** `copySelection` normalized clipboard positions by the raw selection minimum; when the selection's outermost block on an axis was a pipe (coordinate ≡ 1 mod 3), the whole clipboard shifted off the block lattice and paste could never place a single block — silently. The normalization origin is now snapped down to the 3-unit grid period. This is what made select-all → copy → paste of the imported 35-bit adder place nothing.
- **`.dae` import now repairs cubes whose declared type conflicts with their attached pipes.** Some exporters (e.g. ftdp) use a different junction-cube convention; the adder scene contained 100 such cubes, which made every whole-scene rotation/flip abort with "Color rules between adjacent blocks would break". Repaired cubes take the pipe-determined type (or the canonical-first valid option), with a per-cube console note and a summary toast.
- **Cmd/Ctrl+A now selects all from keyboard-build mode too** (it previously fell through to the browser's own select-all there), switching to edit mode first.
- **Rotating a large selection no longer freezes the tab.** The rotation commit cloned the full block map once per rotated block (quadratic); it now clones once and recomputes affected hidden faces after all moves. Rotating the full 9,941-block adder: ~6.4s → ~0.3s.
- **Select-all highlights now cover the whole selection.** Selection highlights were capped at 200 meshes (2% of a large imported scene, clustered in one corner — easy to read as "nothing happened"). Selections above 200 blocks now render as one instanced highlight mesh per block type, covering every selected block.

### Changed
- **Silent no-ops around the clipboard now speak up.** Select-all reports what it selected; copy confirms the block count; arming paste explains the click-to-place step; a paste that places nothing (or drops blocks on collision) says so; pressing a rotate key with nothing selected shows a hint instead of doing nothing. Interactive `.dae` imports surface skipped/repaired/canonicalised counts in a toast (bundled template loads stay silent; console notes remain for auditability).
- **The paste ghost is always visible while paste is armed.** With no hover target it previews the fallback +X placement a hoverless commit would use, instead of rendering nothing until the pointer crosses the grid.
- **Shared paste math extracted to `utils/pasteMath.ts`** (`snapPasteDelta`, `fallbackPasteDelta`) — one source of truth for `commitPaste`, `insertBlocks`, and the paste ghost.

## [0.7.1.0] - 2026-05-13

### Fixed
- **Equiseta `port` faces now render as pipe + port instead of an orphan port marker at a pipe-grid coordinate.** Previously a `port` face emitted only a port marker at offset ±1 from the cube — a pipe-slot position, not a valid port-end. With the fix, every `port` face emits a satellite pipe at the adjacent pipe slot (`±1` for positive directions, `−2` for negative) and a port marker at the pipe's cube-grid endpoint (`±3`). `port_io.json` now imports as 1 cube + 2 pipes + 2 ports; `port_io_pair.json` as 2 cubes + 3 pipes + 2 ports; `koval_q_couch_cnot.json` as 10 cubes + 14 pipes + 4 ports + 1 slab.
- **Hadamard pipe satellites on negative-direction faces no longer land at invalid `isValidPipePos` coordinates.** `emitSatellites` previously used `FACE_OFFSET` (±1) for both port markers and hadamard pipes; this silently placed BOTTOM/SOUTH/WEST hadamard pipes at `mod 3 == 2` positions that fail the pipe-grid validator. No existing fixture exercised the bug, but it would have surfaced the first time a hadamard appeared on a negative-axis face.

### Changed
- **`equisetaNodeToCube.ts` introduces `PIPE_SATELLITE_OFFSET` and `PORT_SATELLITE_OFFSET` maps.** These replace `FACE_OFFSET`'s misuse for satellite-block placement. `PIPE_SATELLITE_OFFSET` matches the convention from `pipeBetween` (cube → adjacent pipe slot, accounting for direction); `PORT_SATELLITE_OFFSET` matches `getAllPortPositions`'s pipe-endpoint offsets (`−1`, `+2` from pipe, which equals `±3` from cube).
- **`pipeCodeForFace(axis, basis)` factored out of `hadamardPipeVariant`.** Returns the 3-letter pipe code (e.g. `XZO`); hadamard appends `H`, port-pipe uses the raw code or falls back via `FALLBACK_PIPE_TYPE_BY_AXIS`. `FALLBACK_PIPE_TYPE_BY_AXIS` moved from `equisetaEdgeToPipe.ts` to `equisetaNodeToCube.ts` to avoid a circular import; the edge translator now imports it.
- **`ImportSuccess.pipeCount` now includes port-pipes** alongside edge-pipes. The `summarizeSuccess` toast reflects the combined count (e.g. `"Imported XXZ cube + 2 pipes + 2 ports from port_io.json"`).

## [0.7.0.0] - 2026-05-12

### Added
- **View any FTQCGraph JSON, even when the pattern isn't a valid TQEC cube/pipe.** The translator now produces a fallback canonical `Block.type` plus a `freeBuildOnly` payload carrying the original face pattern for any `ZZZ`/`XXX` cube or unsupported pipe (`OZZ`/`OXX`/`ZZO`/`XXO`/etc.) seam. The 5 deliberately-invalid pedagogical fixtures (`all_blue.json`, `all_red.json`, `hadamard_top.json`, `blue_pair_east_west.json`, `red_pair_east_west.json`) plus the two-cube `zxx_time_evolution.json` and `port_io_pair.json` now load and render with their input face colours instead of failing at import.
- **Status pill: "N view-only block(s)".** New top-right pill in `StatusPill.tsx` that stays visible whenever any block in the scene carries `freeBuildOnly`. Decouples the "scene contains non-TQEC content" signal from the `ValidationToast` lifecycle so the affordance survives toast dismissal and snapshot URL return-visits.

### Changed
- **`equisetaNodeToCube.ts` is now permissive on cube patterns.** `pickCubeTypeWithFallback` is a 2-entry literal lookup (`ZZZ → XZZ`, `XXX → ZXX`); only these two inputs hit the fallback path because wildcards are already handled upstream. The cube emits with `freeBuildOnly: { reason: "unsupported-pattern", displayPattern }` so the renderer overrides face materials to match the input pattern. Same shape extended to `equisetaEdgeToPipe.ts` for pipe-pattern fallback.
- **Renderer face-material override.** `createBlockGeometry` accepts an optional `displayPattern` parameter; when set, face colours come from the pattern instead of the canonical `blockType`. Geometry shape, hidden faces, and band style still come from `blockType` (Eng-phase invariant: face material only).
- **`ValidationToast` accessibility.** Toast container now has `role="status"` + `aria-live="polite"` so screen readers announce validation results. The clickable error message converted from `<span onClick>` to `<button>` so keyboard `Enter`/`Space` activates it. Added non-colour icon prefix (⚠/ⓘ/✓) so color-blind users see a distinct signal. Addresses the deferred a11y items previously tracked in TODOS.md.
- **`ValidationToast` responsive layout.** Replaced fixed `maxWidth: 500px` + centred transform with `width: min(500px, 100vw - 32px)` so the toast no longer clips on narrow viewports or split-pane usage.

### Removed
- **`unsupported-pattern` rejection toast for fixture imports.** Fixtures previously listed under "Known limitations" in v0.6.1.0 now load via the view-only fallback. The error reason still exists in the `NodeToCubeError` union for synthetic malformed inputs the fallback table can't handle.

## [0.6.1.0] - 2026-05-12

### Added
- **One-click view for Equiseta JSON.** Clicking an example in the `Equiseta ▾` dropdown (or drag-dropping / file-picking any JSON) now auto-imports into the scene — the preview panel still opens, but no extra "Import" click is needed to see the diagram. Valid fixtures (e.g. `zxx_memory.json`, `port_io.json`, `y_defect_ridges.json`) render in one click.
- **Enable Free Build button inside the validation toast.** When an auto-imported scene fails TQEC validation, the existing `ValidationToast` now shows a red solid-fill "Enable Free Build" button as the primary action. One click and you're viewing the invalid scene without warnings. The button only appears when Free Build is OFF — no no-op affordance.

### Changed
- **Server-down distinguished from semantic-invalid.** When `/api/validate` is unreachable or returns a non-2xx response, the validation toast now renders in the amber/error variant with the "Verification server not available" message — distinct from the red "scene fails TQEC rules" variant. The `ValidationResult` schema gained an optional `transportError` discriminator (`gui/src/utils/validate.ts`) and `validationStore` sets `status: "error"` for transport failures instead of conflating them with semantic-invalid. Replaces a fragile substring-match in `ValidationToast.tsx`.
- **Validation runs automatically after import.** `runEquisetaImport` (replace mode) now fires `useValidationStore.validate()` so the toast appears immediately for invalid scenes. The existing `requestVersion` token in `validationStore` discards stale results when imports race, so rapid fixture-clicks always reflect the latest scene.

### Fixed
- **Stale-scene race on rapid fixture clicks.** If a slow fixture's fetch resolved after a faster fixture had already loaded, the slow one used to silently overwrite the new scene. `loadEquisetaFixture` / `loadEquisetaText` now re-check `equisetaJsonStore.loadToken` before calling `runEquisetaImport`, so late arrivals are dropped instead of clobbering the active scene.

### Known limitations
- Fixtures whose nodes have all-blue (`ZZZ`) or all-red (`XXX`) face patterns (`all_blue.json`, `all_red.json`, `hadamard_top.json`, `blue_pair_east_west.json`, `red_pair_east_west.json`) are still rejected by the importer with an "unsupported pattern" toast — they never reach the scene. The autovalidate + Free Build flow can't help these because the importer never produces blocks. Rendering single-colour fixtures requires extending `CUBE_TYPES` or adding a decorative-block path; tracked separately in TODOS.

## [0.6.0.0] - 2026-05-12

### Added
- **Slab element** (free-build only). A fourth element kind alongside cubes, pipes, and ports — a free-build-only authoring affordance that fills the 2×2 interior of a square formed by four horizontal pipes on the XY plane. Renders as two solid grey horizontal plates flush with the top and bottom faces of the surrounding pipes. The Slab toolbar button only appears when free-build is on, and toggling free-build off auto-disarms the tool. Persists via scene snapshot; `.dae` export silently filters slabs out. Upstream PR #255.
- **Y-twist pipes** (free-build only). Pipes can now carry a magenta Y-defect ring that replaces the Hadamard band, modelling a Y-basis twist. Authored via a free-build-only toolbar tool. Upstream PR #257.
- **Free-build Paint tool.** Per-face colour overrides on cubes, pipes, and slabs — repaint individual faces without changing the underlying type. Toolbar tool appears under a new "Free-build" group when free-build is on. Upstream PR #258.
- **Per-cell slab paint** (3×3). Each top/bottom plate of a slab splits into a 3×3 grid (9 cells per face) so each cell can be painted independently with the Paint tool.
- **Per-strip pipe paint.** Every pipe face (plain, Hadamard, Y-twist) exposes three paintable strips along the open axis. Plain and Y-twist pipes use equal thirds for a fat click target; Hadamard keeps its thin yellow band.
- **Paint tool reaches slab bottom face** when looking up at the model from below — `GridPlane` no longer swallows the click.
- Documentation for the **Share link** feature (File ▾ menu) in the README and in-app help. Upstream PR #268.

### Changed
- Wrong-tool clicks on existing slabs now show a yellow banner explaining what to do ("Switch to the Paint tool to recolor an existing slab"), instead of silently failing. Slab tool armed but clicking a non-gap target shows a similar hint.
- Hadamard→Y-twist auto-promote on band repaint now preserves the painted band override, since Y-twist faces also expose a paintable band strip.

### Fixed
- HMR cache invalidation: `blockInstancesShared` clears its geometry caches when the module hot-reloads, so dev sessions no longer see stale geometry after editing `types/index.ts`.
- React Fast Refresh on `BlockInstances.tsx`: extracted the geometry-cache helpers into `blockInstancesShared.ts` so the component file is component-only. Saves now hot-swap state in place instead of triggering a full module reload.

## [0.5.0.0] - 2026-05-12

### Added
- **Equiseta multi-cube import.** The translator now accepts graphs with 2+ nodes and edges. Each edge → one pipe; pipe type derives from the seam axis + connected cubes' basis triples (`OZX`, `OXZ`, `ZOX`, `XOZ`, `ZXO`, `XZO` and their hadamard variants). Eight new bundled fixtures cover the canonical lattice-surgery building blocks from equiseta's `examples/two_cubes/`: `blue_pair_east_west`, `red_pair_east_west`, `zxx_memory_pair`, `xzz_memory_pair`, `zxx_time_evolution`, `hadamard_pipe`, `port_io_pair`, `disconnected_pair`. Four are representable in piper-draw (`zxx_memory_pair`, `xzz_memory_pair`, `hadamard_pipe`, `disconnected_pair`); the other four are pedagogical equiseta fixtures whose cube types (`ZZZ`/`XXX`) or pipe types (`ZZO`) aren't part of piper-draw's surface-code model — they surface diagnostic toasts naming the unsupported pattern, same precedent as the existing single-cube `all_red`/`all_blue`.
- **Grouped Equiseta examples dropdown.** The `EquisetaMenu` dropdown now renders `Single cube` and `Two cubes` sections with subheaders. Manifest shape grew from `examples: []` to `groups: [{label, examples}]`; the loader still accepts the legacy flat shape (wraps into a single unlabeled group) so external manifests don't break.
- **Runtime JSON normalization.** `parseFtqcGraph` silently drops upstream's `"version"` field and lowercases face direction keys (`"BOTTOM"` → `"bottom"`, ...). Lets fresh equiseta JSONs (file-picker drops, drag-and-drop) parse without hand-stripping. Strict mode preserved for every other field — unknown FaceColors, extra node keys, and unknown ridge IDs all still reject loudly.
- **Five new edge-validation errors.** `edge-dangling`, `edge-non-adjacent`, `edge-self-loop`, `edge-duplicate`, `edge-seam-incompatible`, plus a sixth `edge-no-pipe-type` for the four equiseta-valid-but-piper-draw-unrepresentable seam-pipe cases. All surface inline coordinates in the toast for fast diagnosis.

### Changed
- **Internal split of the Equiseta importer.** `equisetaImport.ts` was 432 LOC and growing — past the CLAUDE.md 500 LOC yellow line. Now factored into three files: `equisetaImport.ts` (orchestrator, ~220 LOC), `equisetaNodeToCube.ts` (per-node translation + shared axis utilities, ~370 LOC), `equisetaEdgeToPipe.ts` (edge validation + pipe synthesis, ~260 LOC). No public API changes for the controller (`equisetaImportController.ts`) or panel.
- **Sync script now pins** equiseta SHA `7fe129ce` (head of `peter-janderks/two-qubit-json-examples`). Fetches single-cube and two-cube directories; writes upstream JSON verbatim (canonicalization runs at runtime).
- **Multi-node guard removed.** The `multi-node` rejection error variant is gone; `equisetaToBlocks` returns a populated multi-cube/multi-pipe result.

### Removed
- **Legacy `two_cubes.json`** bundled fixture (the hand-stripped lowercase-faces version). Superseded by `blue_pair_east_west.json` which is the upstream-faithful equivalent.

## [0.4.0.0] - 2026-05-12

### Added
- **Equiseta JSON import.** Two new buttons in the `EquisetaJsonPanel`
  header materialise the loaded JSON onto the 3D grid. **Import** wipes the
  current scene and drops the imported cube + adjacent port markers +
  hadamard pipes at the origin; **Insert** appends them at the +X edge of
  the existing scene (matches the DAE import idiom). Imported blocks
  arrive as a single group so they move and delete as one unit. Five of
  the nine bundled fixtures import cleanly (`zxx_memory`, `xzz_memory`,
  `port_io`, `y_defect_ridges`, `all_open`); the four that have no
  piper-draw cube-type equivalent (`all_red`, `all_blue`, `hadamard_top`,
  `two_cubes`) reject loudly with a diagnostic toast naming the reason.
- **TQEC ↔ Equiseta convention table** documented inline in
  `gui/src/utils/equisetaImport.ts`. `east/west` → X-axis, `north/south`
  → Y-axis, `top/bottom` → Z-axis. `red` → X-basis, `blue` → Z-basis
  (matches piper-draw's `X_COLOR` / `Z_COLOR`). Cube type =
  `basis(east) + basis(north) + basis(top)`. Resulting cube must be one
  of `CUBE_TYPES`; `XXX` and `ZZZ` are not representable and produce a
  rejection. The `all_open` Equiseta node (every face = `open`) emits a
  single port marker as v1's sidestep of the no-XXX/ZZZ-cube limitation.

## [0.3.0.0] - 2026-05-08

### Added
- **Equiseta JSON viewer.** New "Equiseta" toolbar dropdown opens a floating
  panel that displays JSON files produced by [Equiseta](https://github.com/Walrus-Computing/equiseta)'s
  `FTQCGraph.to_json()` serializer. Bundled with 9 example fixtures (8
  single-cube + 1 two-cube) loaded lazily from a manifest; "Open JSON…" and
  drag-and-drop pick arbitrary `.json` files (max 5 MB). Two view modes:
  raw JSON tree (default) and a per-node faces grid showing the 6 face
  colors. Strict hand-rolled schema validator surfaces unknown direction
  keys / unknown FaceColor enum values with structured error paths. First
  step in replacing the TQEC backend with Equiseta — the translator from
  FTQCGraph to piper Block is deliberately deferred to a follow-up PR.

### Changed
- `triggerDaeImport` (`gui/src/utils/daeImport.ts`) now uses the new shared
  `pickFile` helper. Behaviour preserved (silent no-op on cancel,
  console.error + native alert on parse failure); same DAE import UX.

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
