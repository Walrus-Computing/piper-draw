# TODOs

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
- **R7: dissolve toast clobbers in-progress verify highlights** (P2, M, CC ~45 min) — `validationStore.reportEphemeralError` is the only ephemeral-toast surface, but it sets `status: "aborted"` and clears `invalidKeys`/`errors`. The auto-dissolve toast uses this channel as a side effect of unrelated deletes, wiping the rendered red invalid-block highlights. Fix: add a non-destructive toast channel (e.g. `reportEphemeralInfo`) that leaves invalidation state intact, and route the group toasts (dissolve, "Select 2+ blocks", "mixed selection") through it. Same channel-misuse pattern as the migration toast.
- **R10: alt-drilled selection of one group member still verifies the whole group** (P2, S, CC ~20 min) — the `single-grouped` branch in `validationStore.validate` and `ZXPanel.compute` triggers when `selectedKeys.size === 1` and that one block is grouped. After alt+click drill-in, the user expects "verify just this block" but gets "verify the whole group". Fix: distinguish "selection equals an entire group" from "selection is a strict subset of a group" in the classifier; refuse or fall back to whole-scene validate for the strict-subset case, with a toast.
- **R-circular: replace `reportGroupToast` dynamic import with a shared toast bus** (P3, M, CC ~1 hr) — current circular-import workaround uses `void import("./validationStore").then(...)` from inside synchronous reducers. Toasts fire a microtask later, racing block subscribers. Move to a small shared event-bus module that both stores depend on without cycles. Captured during /plan-eng-review codex pass too.

---

Format note: priorities are P1 (do soon) / P2 (do when convenient) / P3 (nice-to-have). Effort scales: XS / S / M / L / XL. CC estimate is wall-clock when using Claude Code; human-team estimate is implicit ~10-20× CC time.
