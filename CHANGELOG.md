# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
a four-digit version: `MAJOR.MINOR.PATCH.MICRO`.

## [Unreleased]

## [0.1.1.1] - 2026-05-01

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
