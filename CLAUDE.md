## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health

## Versioning

The project tracks releases in `VERSION` (repo root) and `CHANGELOG.md` (repo
root, [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format). Version
format is **four digits**: `MAJOR.MINOR.PATCH.MICRO`.

When bumping `VERSION`, also update `gui/package.json`'s `"version"` field to
the same value. The two files are kept in lockstep manually — `/ship`'s
package.json sync logic looks at the repo root and won't reach into `gui/`.

Bump levels:
- **MICRO** (4th digit) — typo, comment, config nudge, single-file < 50 lines.
- **PATCH** (3rd digit) — bug fix or small change, no new features.
- **MINOR** (2nd digit) — new feature or capability. Ask before bumping.
- **MAJOR** (1st digit) — breaking change or milestone. Ask before bumping.

CHANGELOG entries describe what users / TQEC authors / GUI users can now do (or
what stopped breaking). Group by `### Added`, `### Changed`, `### Fixed`,
`### Removed`. Implementation notes belong in commit messages, not the changelog.

## Canonicalisation assumption (colinear-pipe cubes)

A ZXCube sandwiched between two pipes that share the same open axis (e.g. an X-open
pipe at `+x=1` and another X-open pipe at `-x=2`) has two TQEC-valid types that
differ only on the pipe-hidden axis (e.g. `XZZ` vs `XZX`). These two kinds are
semantically distinct in TQEC (different `normal_direction`) but visually
identical in piper-draw.

Piper-draw collapses this ambiguity by always picking the **first valid type in
`CUBE_TYPES` order** (`["XZZ", "ZXZ", "ZXX", "XXZ", "ZZX", "XZX"]`). This rule
is applied:

1. In `syncPortsAndPromote` when a port auto-promotes to a cube (`stores/blockStore.ts`).
2. In `canonicalCubeForPort` used by interactive placement (`types/index.ts`).
3. On `.dae` import for any loaded cube whose position is pipe-ambiguous
   (`utils/daeImport.ts` — emits a console note so imports are auditable).

**Consequence:** a hand-authored TQEC graph that deliberately uses the
non-canonical sandwich type (e.g. `XZX` where piper-draw would pick `ZZX`) will
be silently normalised on import. TQEC validation may therefore compute
different results for the imported scene than for the original graph. Power
users can still override the canonical choice in build mode with the `R` key.

## File-size discipline

The dominant cost of working in this repo is information density per file, not
conventional slop. See [ARCHITECTURE.md](ARCHITECTURE.md) for the module map,
the "files NOT to grow" list, and the decision tree for where to add new code.

Rules:

- **Files >500 LOC are a signal to split.** Treat 500 as a yellow line and 600
  as a hard ESLint cap (when `max-lines` lands). Existing offenders are
  grandfathered until their splits ship.
- **Don't grow `blockStore.ts`, `types/index.ts`, `Toolbar.tsx`, `App.tsx`,
  `ZXPanel.tsx`, `FlowsPanel.tsx`.** Add new state in a focused store
  (`stores/<concern>Store.ts`); add new types in `types/<concern>.ts`; add
  helpers as `utils/<concern>.ts`. The hot-file sizes and split targets live
  in ARCHITECTURE.md and are tracked by the weekly /retro.
- **When MUTATING a Block, spread the original** (`{ ...b, ...changes }`).
  Bare `{ pos, type }` construction is correct ONLY for genuine new-block
  creation paths where there is no existing block to preserve. Bulk-add,
  clipboard, undo-rebuild and cycle paths are the known offender sites — they
  silently drop `faceColors` (paint annotations) and `groupId`. See learning
  `paint-faceColors-lost-on-bulk-add-and-clipboard` for the 7 documented
  sites, and `piper-draw-block-mutator-spread-audit` for the spread-audit
  pattern that should be applied at every Block-construction site.
- **Diagnostic context.** The pattern behind these rules is captured in
  learning `information-density-not-slop`: agents slow down when files become
  too dense, even when conventional slop scans come back green.

If you change module boundaries (move helpers between `utils/`, `stores/`,
`components/`, or change what a store owns), update ARCHITECTURE.md in the
same PR — the PR template has the checklist item and CI gates merges to `dev`
on it.
