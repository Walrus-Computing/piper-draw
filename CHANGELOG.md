# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
a four-digit version: `MAJOR.MINOR.PATCH.MICRO`.

## [Unreleased]

### Added
- Document the **Share link** feature (File ▾ menu) in the README and in-app help.

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
