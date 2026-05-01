# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
a four-digit version: `MAJOR.MINOR.PATCH.MICRO`.

## [Unreleased]

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
