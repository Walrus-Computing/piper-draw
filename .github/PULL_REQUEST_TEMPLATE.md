<!--
  Target branch: dev (see CONTRIBUTING.md). Main is for releases.
-->

## Summary

<!-- 1-3 bullets on what changed and why -->

## Test plan

- [ ] `make test` (or `npm run test` from `gui/`) passes locally
- [ ] Manually exercised the change in the GUI (where applicable)

## Architecture

- [ ] Updated `ARCHITECTURE.md` if module boundaries changed (e.g. helpers moved
      between `utils/` ↔ `stores/`, a hot file split, a new directory added under
      `gui/src/`, or what a store owns changed). If this PR genuinely does not
      affect the architecture map, include `[arch-noop]` in the commit message
      to bypass the CI check.
