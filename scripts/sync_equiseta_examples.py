"""Sync the bundled Equiseta example JSON fixtures from the equiseta repo.

Reads the configurable equiseta repo URL + commit SHA from the constants
below, fetches the 9 example JSON files (8 single-cube + 1 two-cube), and
writes them into ``gui/public/equiseta-examples/``. Also refreshes
``manifest.json`` and updates the source-SHA line in
``gui/public/equiseta-examples/README.md``.

Re-run this script when:
  * Equiseta merges new examples or removes existing ones.
  * The ``FTQCGraph.to_json()`` schema changes (new face colors, new
    ridges, etc.).

Idempotent: rerunning with the same SHA produces no diff (assuming the
upstream files are byte-stable, which equiseta's deterministic dump
guarantees).

Usage:
    uv run python scripts/sync_equiseta_examples.py

The script prefers a local equiseta clone (faster, offline) at the path
in ``LOCAL_CLONE``. If that doesn't exist, it falls back to fetching from
GitHub via the raw API.
"""

from __future__ import annotations

import json
import re
import subprocess
import urllib.request
from pathlib import Path

# ---------------------------------------------------------------------------
# Configurable constants (edit when bumping equiseta).
# ---------------------------------------------------------------------------

EQUISETA_REPO = "Walrus-Computing/equiseta"
# Source SHA is the head of peter-janderks/ftqcgraph-to-json (equiseta PR #29).
EQUISETA_REF = "b77aed151d92ca9b97f67bf7f6eddd22ada902fe"
LOCAL_CLONE = Path.home() / "conductor" / "repos" / "equiseta"

# (filename, source path inside equiseta repo)
SINGLE_CUBE_NAMES = [
    "all_open",
    "all_red",
    "all_blue",
    "zxx_memory",
    "xzz_memory",
    "hadamard_top",
    "port_io",
    "y_defect_ridges",
]

OUT_DIR = Path(__file__).resolve().parents[1] / "gui" / "public" / "equiseta-examples"


# ---------------------------------------------------------------------------
# Manifest description table — kept here (not in equiseta) so piper-draw can
# evolve UI copy without round-tripping through the upstream repo.
# ---------------------------------------------------------------------------

MANIFEST_DESCRIPTIONS: dict[str, tuple[str, str]] = {
    "all_open.json": ("All open", "Every face OPEN. Minimal connector cube."),
    "all_red.json": ("All red", "Every face RED."),
    "all_blue.json": ("All blue", "Every face BLUE."),
    "zxx_memory.json": (
        "ZXX memory",
        "RED top/bottom, BLUE sides. Surface-code memory cube (Z time-boundary, X space-boundary).",
    ),
    "xzz_memory.json": (
        "XZZ memory",
        "BLUE top/bottom, RED sides. Opposite-basis memory cube.",
    ),
    "hadamard_top.json": ("Hadamard top", "RED bottom and sides, HADAMARD on top."),
    "port_io.json": ("Port I/O", "RED sides, PORT top and bottom."),
    "y_defect_ridges.json": (
        "Y defect ridges",
        "ZXX faces with K_SOUTH_WEST=true, K_SOUTH_EAST=false. "
        "Demonstrates all three is_y_defect states.",
    ),
    "two_cubes.json": (
        "Two cubes",
        "Two BLUE cubes sharing one OPEN face along the i-axis.",
    ),
}


def _fetch_local(repo: Path, ref: str, path_in_repo: str) -> str | None:
    """Fetch via `git show` from a local clone. Returns None if unavailable."""
    if not (repo / ".git").exists():
        return None
    try:
        out = subprocess.run(
            ["git", "-C", str(repo), "show", f"{ref}:{path_in_repo}"],
            capture_output=True,
            text=True,
            check=True,
        )
        return out.stdout
    except subprocess.CalledProcessError as e:
        # Could be that this clone doesn't have the SHA yet — try fetching.
        try:
            subprocess.run(
                ["git", "-C", str(repo), "fetch", "origin", ref],
                capture_output=True,
                check=True,
            )
            out = subprocess.run(
                ["git", "-C", str(repo), "show", f"{ref}:{path_in_repo}"],
                capture_output=True,
                text=True,
                check=True,
            )
            return out.stdout
        except subprocess.CalledProcessError:
            print(f"  local fetch failed for {path_in_repo}: {e.stderr.strip()}")
            return None


def _fetch_remote(repo: str, ref: str, path_in_repo: str) -> str:
    """Fetch via GitHub raw API. Raises on failure."""
    url = f"https://raw.githubusercontent.com/{repo}/{ref}/{path_in_repo}"
    with urllib.request.urlopen(url, timeout=10) as resp:  # noqa: S310 — trusted host
        return resp.read().decode("utf-8")


def _fetch(path_in_repo: str) -> str:
    """Try local clone first, fall back to GitHub raw."""
    text = _fetch_local(LOCAL_CLONE, EQUISETA_REF, path_in_repo)
    if text is not None:
        return text
    print(f"  (local clone miss; fetching from GitHub: {path_in_repo})")
    return _fetch_remote(EQUISETA_REPO, EQUISETA_REF, path_in_repo)


def _write_manifest() -> None:
    """Regenerate manifest.json from MANIFEST_DESCRIPTIONS."""
    examples = []
    # Order matches the table — single-cube first, then two_cubes.
    ordered = [f"{n}.json" for n in SINGLE_CUBE_NAMES] + ["two_cubes.json"]
    for filename in ordered:
        name, description = MANIFEST_DESCRIPTIONS[filename]
        examples.append({"filename": filename, "name": name, "description": description})
    manifest = {
        "source": f"https://github.com/{EQUISETA_REPO}/pull/29",
        "regenerate": (
            "Run scripts/sync_equiseta_examples.py to refresh from the equiseta repo. "
            "See gui/public/equiseta-examples/README.md."
        ),
        "examples": examples,
    }
    text = json.dumps(manifest, indent=2) + "\n"
    (OUT_DIR / "manifest.json").write_text(text)
    print("  wrote manifest.json")


def _update_readme_sha() -> None:
    """Replace the SHA on the `Source SHA:` line of README.md."""
    readme_path = OUT_DIR / "README.md"
    if not readme_path.exists():
        print("  (README.md missing — skipped SHA update; create it once and re-run)")
        return
    content = readme_path.read_text()
    new_content = re.sub(
        r"(- Source SHA: `)[0-9a-f]{40}(`)",
        rf"\g<1>{EQUISETA_REF}\g<2>",
        content,
    )
    if new_content != content:
        readme_path.write_text(new_content)
        print("  updated README.md source SHA")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Syncing Equiseta examples from {EQUISETA_REPO}@{EQUISETA_REF[:7]} → {OUT_DIR}")

    for name in SINGLE_CUBE_NAMES:
        filename = f"{name}.json"
        path_in_repo = f"examples/single_cube/{filename}"
        text = _fetch(path_in_repo)
        (OUT_DIR / filename).write_text(text)
        print(f"  wrote {filename} ({len(text)} bytes)")

    text = _fetch("examples/two_cubes.json")
    (OUT_DIR / "two_cubes.json").write_text(text)
    print(f"  wrote two_cubes.json ({len(text)} bytes)")

    _write_manifest()
    _update_readme_sha()
    print("Done.")


if __name__ == "__main__":
    main()
