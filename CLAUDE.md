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
