# AI-Generated Code Policy

This document describes how AI tools were used in the development of piper-draw and what steps have been taken to assess intellectual property risk.

## AI Usage Disclosure

This codebase was developed with significant assistance from AI coding tools (Claude by Anthropic). AI was used for:

- Writing application source code (TypeScript frontend, Python backend)
- Writing tests
- Code review and refactoring

## Scans Performed

### License and Copyright Scan (scancode-toolkit v32.5.0)

**Date:** 2026-04-15
**Tool:** [scancode-toolkit](https://github.com/nexB/scancode-toolkit)
**Command:** `scancode -cl -n 4 --json-pp scan-results.json .`

**Result:** No license headers or copyright notices were detected in any source files. The only license detections were in `package-lock.json`, corresponding to declared licenses of npm dependencies (MIT, Apache 2.0, ISC, BSD, MPL-2.0). All dependency licenses are permissive or weak copyleft. The MPL-2.0 matches are all from `lightningcss` (a build-time CSS toolchain dependency, not bundled into source).

### Code Clone Detection (jscpd v4)

**Date:** 2026-04-15
**Tool:** [jscpd](https://github.com/kucherenko/jscpd)
**Command:** `jscpd ./piper_draw/gui/src -f typescript,javascript -l 5 -k 50 --gitignore`

**Result:** 8 internal clones found across 12 files (2.79% duplication rate). All duplications are within the project itself (test setup boilerplate and repeated utility logic). No cross-project similarity was flagged.

### Web Source Similarity Scan (Codequiry)

**Date:** 2026-04-15
**Tool:** [Codequiry](https://codequiry.com) (API v1)

**Scan 1 — Group Similarity (test_type=9):**
- 5,201 lines scanned against ~25.8 billion indexed sources
- Local matches: 0.00%
- Web matches: 0.00%
- Matches found: 0
- AI detection score: 32%

**Scan 2 — Web + Group Similarity (test_type=1):**
- 5,201 lines scanned against ~25.5 billion indexed sources (GitHub, StackOverflow, Gist)
- Local matches: 0.00%
- Web matches: 2.91% (144 matches across ~2.1M similar files)
- AI detection score: 32%

**Result:** Near-zero web similarity. The 2.91% web match rate with 144 matches across millions of indexed files indicates common patterns (e.g., standard React/TypeScript idioms), not copied code. The 32% AI detection score is consistent with the disclosed AI-assisted development.

### Secret and Credential Scan (gitleaks v8)

**Date:** 2026-04-15
**Tool:** [gitleaks](https://github.com/gitleaks/gitleaks)
**Command:** `gitleaks detect --source . -v`

**Result:** 571 commits scanned (~198 MB). No leaks found. No API keys, tokens, passwords, or other credentials detected in the repository history.

## Dependency Licenses

All npm dependencies use permissive or weak copyleft licenses:

| License | Notes |
|---|---|
| MIT | Majority of dependencies |
| Apache 2.0 | Permissive, patent grant included |
| ISC | Functionally equivalent to MIT |
| BSD (2/3-clause) | Permissive |
| MPL-2.0 | `lightningcss` only; file-level copyleft, build-time dependency |

## Limitations

- **scancode-toolkit** detects license text and copyright notices. It does not perform semantic code similarity analysis.
- **jscpd** detects token-level code clones. It does not detect functionally equivalent but structurally different code.
- **Codequiry** compares against a large web index but a low match percentage does not guarantee zero overlap with all existing code.
- No tool can guarantee that AI-generated code is entirely free of similarity to existing works. No tool can provide this guarantee for human-written code either.
- These scans reflect the state of the codebase at the time they were run. They should be re-run periodically and before major releases.

## Re-running Scans

To re-run these scans:

```bash
# License and copyright scan
pip install scancode-toolkit
scancode -cl -n 4 --json-pp scan-results.json .

# Code clone detection
npm install -g jscpd
jscpd ./piper_draw/gui/src -f typescript,javascript -l 5 -k 50 --gitignore

# Secret and credential scan
brew install gitleaks  # or see https://github.com/gitleaks/gitleaks
gitleaks detect --source . -v
```

## License

This project's own license is defined in the repository root. Consumers should review both this project's license and the dependency licenses listed above.
