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
