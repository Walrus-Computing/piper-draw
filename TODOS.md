# TODOs

## Deferred from CEO + ENG plan: Import Equiseta JSON (2026-05-11)

Source: `~/.gstack/projects/peter-janderks-piper-draw-raw/ceo-plans/2026-05-11-import-equiseta-json.md`
plus the branch's eng-review test plan. Decided during /plan-ceo-review +
/plan-eng-review and explicitly deferred to keep the v0.4 single-node import
PR focused.

- ~~**Multi-node import + edge translation**~~ — **Completed in v0.5.0.0
  (2026-05-12).** `equisetaImport.ts` handles multi-cube graphs; edges map
  to pipes via the seam-axis + perpendicular-basis convention in
  `equisetaEdgeToPipe.ts`. 8 new bundled fixtures added.
- **Export (Blocks → FTQCGraph JSON)** (P2, L, CC ~2 hr) — the inverse
  of the v0.4 translator; needed for full TQEC retirement. Depends on
  the convention table being authoritative (locked in eng-review).
  Trigger: v0.6 milestone.
- **`null` vs `open` face semantics distinction** (P3, XS) — v1 treats
  both as "no satellite emitted". They may have distinct meanings in
  Equiseta (e.g. `null` = uncolored placeholder vs `open` = explicit
  boundary). Revisit if the Equiseta team clarifies the spec.
- **Revisit `all_open.json` and unsupported-cube semantics in v0.5**
  (P3, S) — v1 emits a port marker for all-open nodes (a hack to
  sidestep the no-XXX/ZZZ-cube limitation in piper-draw). Once
  multi-node import lands, a port adjacent to a connected node has
  different semantics than a standalone port; the hack may need
  replacing. Depends on multi-node import.
- **`ridges` payload preservation on import** (P3, S) — v1 drops
  the 12-flag `ridges` field per node. `y_defect_ridges.json` currently
  imports as a plain `ZZX` cube with no defect markers, even though
  piper-draw has `Y_DEFECT_COLOR` infrastructure that could render
  them. Honor on import; render Y-defect markers per existing piper-draw
  machinery. (User noted they don't need this in the short term.)
- **Camera fit after import** (P3, XS, CC ~10 min) — auto-center on
  the imported region so the cube doesn't appear off-screen. The
  D5 success toast (info channel) is a workable v1 substitute.
- **Approach C bidirectional translator scaffold** (P2, S) — revisit
  when export work begins; create a single `equisetaTranslator.ts`
  with both `equisetaToBlocks` and `blocksToEquiseta` for clean
  serializer ↔ deserializer separation. Trigger: v0.6 export milestone.
- **EquisetaMenu toolbar shortcut for Import/Insert** (P3, XS) — v1
  hangs the Import/Insert buttons off the panel header. Toolbar
  dropdown shortcuts (so the panel doesn't have to be open) are deferred.
  Trigger: user feedback that the panel-only flow is friction.

---

## Deferred from /autoplan: Auto-import + Free Build toast (2026-05-12)

Source: `~/.claude/plans/system-instruction-you-are-working-twinkling-duckling.md`
plus the /autoplan dual-voice review. Decided during /autoplan SELECTIVE EXPANSION
and final approval gate, explicitly held out of the v0.6.1.0 ship.

- ~~**Render single-colour fixtures (`all_blue.json`, `all_red.json`,
  `hadamard_top.json`, `blue_pair_east_west.json`, `red_pair_east_west.json`)**~~
  — **Completed in v0.7.0.0 (2026-05-12).** Approach B (Block.freeBuildOnly
  flag) per /autoplan 2026-05-12. Translator now picks a deterministic
  canonical fallback (`ZZZ → XZZ`, `XXX → ZXX`; pipes: `O.. → OZX`,
  `.O. → ZOX`, `..O → ZXO`) and emits `freeBuildOnly: { reason, displayPattern }`
  so the renderer overrides face materials. Also covers `zxx_time_evolution.json`
  and `port_io_pair.json` (pipe-pattern fallback).
- **Tri-state validation outcome (E1)** (P2, M) — distinguish
  "intentionally-non-TQEC fixture" from "user-error invalid scene" so the
  toast can use a third copy variant. v0.6.1.0 ships the
  semantic-invalid-vs-server-down split (UC2). The third axis needs
  per-fixture metadata or content heuristics; deferred.
- **Confirm-before-nuke on unsaved-work (E4)** (P2, XS, CC ~15 min) — auto-import
  silently replaces the current scene. Both /autoplan CEO reviewers flagged
  this. Add a confirm prompt when blocks count is non-zero and clicking a new
  fixture. Trigger: user reports losing work.
- **Dropdown thumbnails for Equiseta examples (E5)** (P3, L, CC ~3 hr) — Claude
  CEO reviewer noted the deeper UX gap is "I can't remember what each fixture
  looks like." Render a small 64px scene preview alongside the manifest entries.
  Skipped because it requires offline-rendering each fixture at build time.
- ~~**ValidationToast a11y overhaul**~~ — **Completed in v0.7.0.0 (2026-05-12).**
  Added `role="status"` + `aria-live="polite"` to all toast variants; converted
  the clickable error message from `<span>` to `<button>`; added non-colour
  icon prefix (⚠/ⓘ/✓) so colour-blind users see a distinct signal. Pulled
  into the freeBuildOnly PR because the toast became the load-bearing v1
  signal for view-only blocks per /autoplan 2026-05-12 design phase.
- ~~**ValidationToast responsive overhaul**~~ — **Completed in v0.7.0.0
  (2026-05-12).** Replaced fixed `maxWidth: 500px` with
  `width: min(500px, 100vw - 32px)` so narrow viewports and split-pane no
  longer clip the toast. Shipped alongside the a11y overhaul.
- **AbortController on `validate()` fetch** (P3, S, CC ~20 min) — when rapid
  imports happen, the existing `requestVersion` token discards stale results
  on arrival but the in-flight fetches keep running and waste server work.
  Adding an AbortController would cancel them. Correctness is fine today; this
  is pure perf.
- **`commitScene()` helper in `blockStore`** (P3, S) — would let `.dae` import,
  template loads, and undo all auto-validate without duplicating the
  `runEquisetaImport` wiring. Deferred because it couples `blockStore` to
  `validationStore` (`blockStore` is a CLAUDE.md hot file); revisit only if
  `.dae` import grows similar requirements.

---

## Deferred from /autoplan: View any FTQCGraph JSON via freeBuildOnly (2026-05-12)

Source: `~/.gstack/projects/peter-janderks-piper-draw-raw/pderks-peter-janderks-import-any-json-free-mode-design-20260512-193150.md`
plus the /autoplan dual-voice review. Decided during the autoplan SELECTIVE
EXPANSION and final approval gate; held out of v0.7.0.0 to keep the PR
right-sized.

- **Distinct visual mark on `freeBuildOnly` blocks** (P3, S, CC ~45 min) —
  corner badge / dashed outline / desaturation so view-only blocks visually
  read apart from valid TQEC blocks even after the toast dismisses. v1 ships
  the status pill + auto-Free-Build affordance instead. Trigger: user
  feedback that the pill alone isn't strong enough.
- **CI grep rule for bare `{pos, type}` Block construction** (P3, XS, CC ~15 min)
  — D2 from the autoplan eng-review test plan. A pre-commit hook or ESLint
  custom rule fails new bare `{pos, type}` constructions in `blockStore.ts`
  / `types/index.ts`. The D1 property test (`blockStore.test.ts:freeBuildOnly`
  suite) already catches the same regression class at test time; the grep
  rule is the static-analysis polish. Trigger: another optional Block field
  is added (each new field is a fresh spread-audit reason).
- **Observability counters for fallback rate** (P3, XS, CC ~20 min) — Codex
  flagged in the eng-review dual-voice. Track how often the
  `pickCubeTypeWithFallback` / `resolvePipeTypeWithFallback` path fires in
  production so silent fallbacks can be spotted before they become a
  semantic divergence. Today the only path is fixture imports; if/when
  arbitrary FTQCGraph JSON becomes a common user input, this metric tells
  us when the fallback table needs extending.
- **Renderer integration test for `displayPattern` override** (P3, S, CC ~45 min)
  — E-suite from the test plan. Verifies a `freeBuildOnly` cube with
  `displayPattern = "ZZZ"` actually shows 6 blue faces in the rendered scene.
  Requires React Testing Library + Three.js geometry-inspection setup. Manual
  verification covers v1; automated test is polish.
- **StatusPill component test** (P3, XS, CC ~15 min) — G-suite. Asserts pill
  is hidden when 0 freeBuildOnly blocks; shows correct singular/plural label
  for 1+. Manual verification covers v1.
- **Cycle-undo semantic for view-only cubes** (P3, S, CC ~30 min) — design doc
  spec'd: "cycle clears `freeBuildOnly`; undo restores it". Today: cycle
  preserves the field (spread `{...b, type: newType}`) so cycling a view-only
  cube keeps the view-only marker on the new canonical type, which is
  semantically wrong. Fix: explicitly drop `freeBuildOnly` on cycle forward;
  store the dropped value in the cube-cycle undo command so undo can restore
  it. Workaround today: re-import the source JSON to recover view-only state.
  Trigger: user reports surprise that cycling a view-only cube doesn't
  promote it to "real" canonical.

---

## Deferred from CEO + ENG plan: View Equiseta JSON (2026-05-08)

Source: `~/.gstack/projects/peter-janderks-piper-draw-raw/ceo-plans/2026-05-08-view-equiseta-json.md`
plus the branch's plan file. Decided during /plan-ceo-review (E1z, E5) and
left in scope after /plan-eng-review.

- **Zod (or other JSON-schema validation library)** (P3, S, CC ~30 min) —
  revisit when ≥3 JSON schemas live in the codebase or the hand-rolled
  validator at `gui/src/utils/equisetaJsonSchema.ts` gets unwieldy. Trigger:
  schema-count crosses 3, or validator file passes ~250 LOC. Migration is
  mechanical (rewrite the parse functions in zod's DSL).
- **Compare mode for Equiseta JSON viewer** (P3, M, CC ~1.5 hr) — second
  drop slot in `EquisetaJsonPanel`; load fileA + fileB, render side-by-side
  with a "these fields differ" tint. Useful when tweaking the equiseta
  serializer to confirm the dump didn't drift, or when comparing two
  builders. Depends on the basic viewer (this PR) landing first.

(Mobile / narrow-viewport polish was originally deferred but scope-promoted
into the implementation PR — viewport-clamped panel default geometry now
ships with the feature.)

---

## Deferred from CEO plan: Group Elements (2026-04-29)

Source: `.context/ceo-plans/2026-04-29-group-elements.md`. These were considered during the CEO plan review and explicitly deferred so the v1 group-elements PR stays focused.

### Group feature follow-ups (in priority order, all P2-P3)

- **Per-group verify status badge** (P2, M, CC ~1 hr) — persistent green/red outline color override on a group after running verify; clears when any member is edited. Adds verify-result cache + invalidation. Skipped from v1 to keep cache logic out of the initial scope.
- **Sidebar panel listing all groups** with rename + recolor + select-group-by-click (P2, L, CC ~2-3 hr) — depends on group rename UI below. Once it ships, color collisions (>8 groups share a hue) become trivially disambiguated.
- **Group rename UI** (P3, S, CC ~30 min) — inline edit on a group label or `F2` to rename. Auto-name "Group N" works for v1; rename adds polish + needs string sanitization on snapshot/URL load when it ships.
- **Hide/show group visibility toggle** (P3, S, CC ~30 min) — hide a group's blocks while iterating elsewhere. Useful for complex scenes; not load-bearing for v1.
- **Nested groups** (P3, L) — deferred indefinitely; nesting introduces hairy interaction edge cases (partial selection across nesting levels, ungroup-with-nested-children semantics) and was not in the user description.
- **DAE export of group metadata** (P3, S) — preserve groups across .dae round-trip via `<extra>` tags. Currently consistent with how slabs are dropped on DAE export. Re-evaluate when group library workflow emerges.
- **Group bounding-box gizmo** (P3, S, CC ~30 min) — faint translucent box around a selected group's extents (CAD-style). Visual polish, not load-bearing.
- **Drag-add to existing group** (P3, S) — modifier+click an ungrouped element to add it to a currently-selected group, instead of re-selecting all members + the new one + pressing `g`. Workflow shortcut.
- **Auto-group suggestion on connected component** (P3, M) — when marquee selects a connected component, offer "Group these as one?" via a one-time hint. Speculative until users ask for it.

### Architecture

- **Selection-consumer audit smoke test** (P2, XS, CC ~10 min) — add a test that clicking one member of an 8-block group makes the transformer gizmo wrap the bounding box of all 8 members. Confirms group fan-out doesn't break existing selection-driven UI.

### Group feature follow-ups (from /review red-team pass on group-elements PR)

- **R2-leftover: auto-dissolve sweep on `convertBlockToPort` and `cycleSelectedType` cube→port branch** (P1, S, CC ~30 min) — `removeBlock` (single-block + cascade) and `deleteSelected` now run the auto-dissolve sweep, but converting a grouped cube to a port marker (port-tool click) and cycling a grouped cube past the port slot in edit mode also delete a block without restoring the ≥2-member invariant. Extract the same `applyAutoDissolve` helper used elsewhere; extend `replace` and `edit-type-cycle` UndoCommand kinds with `autoDissolvedFor` and mirror in undo+redo.
- **R5: shift-click on a grouped block is union-only — no toggle** (P2, S, CC ~30 min) — shift+click on an ungrouped block toggles the block in/out of selection; shift+click on a grouped block always unions the whole group. Same gap on shift+marquee. Fix: when shift is held and every member of the clicked block's group is already selected, call a deselect path; otherwise union. Mirror in `SelectModePointer` marquee expander.
- **R10: alt-drilled selection of one group member still verifies the whole group** (P2, S, CC ~20 min) — the `single-grouped` branch in `validationStore.validate` and `ZXPanel.compute` triggers when `selectedKeys.size === 1` and that one block is grouped. After alt+click drill-in, the user expects "verify just this block" but gets "verify the whole group". Fix: distinguish "selection equals an entire group" from "selection is a strict subset of a group" in the classifier; refuse or fall back to whole-scene validate for the strict-subset case, with a toast.

---

## Completed

- **R7: dissolve toast clobbers in-progress verify highlights** — Completed: v0.1.3.0 (2026-05-01). PR 5a introduced `toastBus` with separate `error` and `info` channels. Auto-dissolve / "Select 2+" / mixed-selection / migration toasts now route through `info` and no longer clear `validationStore.invalidKeys`.
- **R-circular: replace `reportGroupToast` dynamic import with a shared toast bus** — Completed: v0.1.3.0 (2026-05-01). Same PR. `gui/src/utils/toastBus.ts` is the shared module both stores depend on without cycles; the `void import("./validationStore").then(...)` workaround is gone.

---

Format note: priorities are P1 (do soon) / P2 (do when convenient) / P3 (nice-to-have). Effort scales: XS / S / M / L / XL. CC estimate is wall-clock when using Claude Code; human-team estimate is implicit ~10-20× CC time.
