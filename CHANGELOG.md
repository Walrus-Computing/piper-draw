# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
a four-digit version: `MAJOR.MINOR.PATCH.MICRO`.

## [Unreleased]

### Added
- Document the **Share link** feature (File ▾ menu) in the README and in-app help.

## [0.1.2.0] - 2026-05-04

### Added
- Manual correlation-surface tool: arm Corr X (red) or Corr Z (blue) from the
  Surfaces toolbar group, then click any pipe face to paint an internal
  cross-section quad on that block. Same-basis click toggles off; other-basis
  click switches. Marks render as flat quads at the block's centerline along
  the slice axis, matching what TQEC's `/api/flows` returns (verified
  byte-for-byte against OZX and OZXH pipes). v1 is pipe-only — cubes, slabs,
  and Y blocks ignore corr-surface clicks. Designed for empirical study of
  free-build pipes (Y-twist, Hadamard) where TQEC's analyzer can't compute
  surfaces automatically.
- Show / Hide toggle next to the Corr buttons. When marks are visible, all
  blocks dim slightly so the surface quads read clearly.
- New `Block.corrSurfaceMarks` field — axis-keyed (not face-keyed): plain keys
  `"0" | "1" | "2"` for cubes/slabs/Y, plus `"<axis>:below|band|above"` for
  Hadamard / Y-twist pipes where the strip clips along the open axis.

### Changed
- `GridPlane` no longer places stray cubes when a face-targeting tool (Paint,
  Corr X, Corr Z) is armed and the click misses every block. The new
  `isFaceTargetingTool` helper short-circuits both the click handler and the
  pointer-move ghost preview.

### Fixed
- Paint preservation through bulk operations: bulk-add undo, promote/demote,
  cube/pipe cycle, and clipboard paste now spread the original block so
  `faceColors`, `corrSurfaceMarks`, and `groupId` survive. Previously these
  paths reconstructed minimal blocks and silently dropped annotations.

## [0.1.1.0] - 2026-05-04

### Added
- Slab paint cells: each top/bottom plate splits into a 3×3 grid (9 cells per face) so each cell can be painted independently with the Paint tool.
- Pipe paint strips: every pipe face (plain, Hadamard, Y-twist) exposes three paintable strips along the open axis. Plain and Y-twist pipes use equal thirds for a fat click target; Hadamard keeps its thin yellow band.
- Paint tool can now reach the bottom face of a slab when looking up at it from below — `GridPlane` no longer swallows the click.

### Changed
- Wrong-tool clicks on existing slabs now show a yellow banner explaining what to do ("Switch to the Paint tool to recolor an existing slab"), instead of silently failing. Slab tool armed but clicking a non-gap target shows a similar hint.
- Hadamard→Y-twist auto-promote on band repaint now preserves the painted band override, since Y-twist faces also expose a paintable band strip.

### Fixed
- HMR cache invalidation: `blockInstancesShared` clears its geometry caches when the module hot-reloads, so dev sessions no longer see stale geometry after editing `types/index.ts`.
- React Fast Refresh on `BlockInstances.tsx`: extracted the geometry-cache helpers into `blockInstancesShared.ts` so the component file is component-only. Saves now hot-swap state in place instead of triggering a full module reload.

## [0.1.0.0] - 2026-04-30

### Added
- Begin tracking releases in `VERSION` and `CHANGELOG.md`. Prior changes are in
  the git history and merged PRs (#231-#259).
