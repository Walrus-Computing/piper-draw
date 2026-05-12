"""Sync the bundled Equiseta example JSON fixtures from the equiseta repo.

Reads the configurable equiseta repo URL + commit SHA from the constants
below, fetches the example JSON files (8 single-cube from
``examples/single_cube/`` + 8 two-cube from ``examples/two_cubes/``), and
writes them into ``gui/public/equiseta-examples/``. Also refreshes
``manifest.json`` with grouped sections and updates the source-SHA line in
``gui/public/equiseta-examples/README.md``.

Re-run this script when:
  * Equiseta merges new examples or removes existing ones.
  * The ``FTQCGraph.to_json()`` schema changes (new face colors, new
    ridges, etc.).

Upstream JSONs use UPPERCASE face direction keys and include a top-level
``"version"`` marker since equiseta v0.0.0+. piper-draw's runtime parser
(``canonicalizeEquisetaJson`` in ``equisetaJsonSchema.ts``) drops the
version field and lowercases face keys at load time, so this script writes
upstream JSON **verbatim**: on-disk fixtures stay byte-identical to the
source for trivially debuggable diffs.

Idempotent: rerunning with the same SHA produces no diff.

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
# Source SHA is the head of peter-janderks/two-qubit-json-examples (commit
# "Add curated two-cube example FTQCGraph JSONs").
EQUISETA_REF = "7fe129ce42684cd12340a50fd0721d7a7e0a9d13"
LOCAL_CLONE = Path.home() / "conductor" / "repos" / "equiseta"

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

TWO_CUBE_NAMES = [
    "blue_pair_east_west",
    "red_pair_east_west",
    "zxx_memory_pair",
    "xzz_memory_pair",
    "zxx_time_evolution",
    "hadamard_pipe",
    "port_io_pair",
    "disconnected_pair",
]

OUT_DIR = Path(__file__).resolve().parents[1] / "gui" / "public" / "equiseta-examples"


# ---------------------------------------------------------------------------
# Manifest description table — kept here (not in equiseta) so piper-draw can
# evolve UI copy without round-tripping through the upstream repo.
# ---------------------------------------------------------------------------

MANIFEST_DESCRIPTIONS: dict[str, tuple[str, str]] = {
    # Single cube
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
    # Two cubes
    "blue_pair_east_west.json": (
        "Blue pair (east-west)",
        "Two all-BLUE cubes joined east-west via OPEN. Degenerate (ZZZ) — surfaces an unsupported-pattern toast.",
    ),
    "red_pair_east_west.json": (
        "Red pair (east-west)",
        "Two all-RED cubes joined east-west via OPEN. Degenerate (XXX) — surfaces an unsupported-pattern toast.",
    ),
    "zxx_memory_pair.json": (
        "ZXX memory pair",
        "Two ZXX-memory cubes merged east-west via OPEN. Lattice-surgery merge along the X axis.",
    ),
    "xzz_memory_pair.json": (
        "XZZ memory pair",
        "Two XZZ-memory cubes merged east-west via OPEN. Opposite-basis counterpart of zxx_memory_pair.",
    ),
    "zxx_time_evolution.json": (
        "ZXX time evolution",
        "Two ZXX cubes stacked along K (time) sharing an OPEN face. piper-draw can't model the ZZO seam pipe — surfaces an unsupported-pipe toast.",
    ),
    "hadamard_pipe.json": (
        "Hadamard pipe",
        "Two ZXX cubes joined east-west via a HADAMARD pipe (basis change between qubits).",
    ),
    "port_io_pair.json": (
        "Port I/O pair",
        "Two ZXX cubes stacked along K with PORT on outer faces. Same ZZO seam pipe limitation as zxx_time_evolution — surfaces an unsupported-pipe toast.",
    ),
    "disconnected_pair.json": (
        "Disconnected pair",
        "Two ZXX cubes at non-adjacent coordinates — no edge, no pipe.",
    ),
}


# Manifest groups define the dropdown's section structure.
MANIFEST_GROUPS: list[tuple[str, list[str]]] = [
    ("Single cube", [f"{n}.json" for n in SINGLE_CUBE_NAMES]),
    ("Two cubes", [f"{n}.json" for n in TWO_CUBE_NAMES]),
]


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
    """Regenerate manifest.json from MANIFEST_GROUPS + MANIFEST_DESCRIPTIONS."""
    groups = []
    for label, filenames in MANIFEST_GROUPS:
        items = []
        for filename in filenames:
            name, description = MANIFEST_DESCRIPTIONS[filename]
            items.append({"filename": filename, "name": name, "description": description})
        groups.append({"label": label, "examples": items})
    manifest = {
        "source": f"https://github.com/{EQUISETA_REPO}/tree/{EQUISETA_REF}/examples",
        "regenerate": (
            "Run scripts/sync_equiseta_examples.py to refresh from the equiseta repo. "
            "See gui/public/equiseta-examples/README.md."
        ),
        "groups": groups,
    }
    text = json.dumps(manifest, indent=2) + "\n"
    (OUT_DIR / "manifest.json").write_text(text)
    print("  wrote manifest.json (grouped)")


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


def _retire_legacy_two_cubes() -> None:
    """Remove the legacy bundled `two_cubes.json` (hand-stripped single-file
    pre-v0.5 fixture). v0.5 ships the grouped two-cube fixtures instead.
    """
    legacy = OUT_DIR / "two_cubes.json"
    if legacy.exists():
        legacy.unlink()
        print("  removed legacy two_cubes.json (superseded by blue_pair_east_west.json et al.)")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Syncing Equiseta examples from {EQUISETA_REPO}@{EQUISETA_REF[:7]} → {OUT_DIR}")

    for name in SINGLE_CUBE_NAMES:
        filename = f"{name}.json"
        path_in_repo = f"examples/single_cube/{filename}"
        text = _fetch(path_in_repo)
        (OUT_DIR / filename).write_text(text)
        print(f"  wrote {filename} ({len(text)} bytes)")

    for name in TWO_CUBE_NAMES:
        filename = f"{name}.json"
        path_in_repo = f"examples/two_cubes/{filename}"
        text = _fetch(path_in_repo)
        (OUT_DIR / filename).write_text(text)
        print(f"  wrote {filename} ({len(text)} bytes)")

    _retire_legacy_two_cubes()
    _write_manifest()
    _update_readme_sha()
    print("Done.")


if __name__ == "__main__":
    main()
