"""Generate the bundled .bgraph example files served by piper-draw.

Output: `gui/public/bgraph-examples/*.bgraph` plus a `manifest.json` listing
them. Run once and commit the output to git; this is NOT a CI step. Re-run
manually when adding a new example or when TQEC's bgraph schema bumps.

Usage:
    uv run python scripts/generate_bgraph_examples.py

The script is idempotent — re-running overwrites the existing files.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from tqec import gallery
from tqec.interop.bgraph import write_bgraph

# Each entry: (filename without extension, display name, short description, factory).
EXAMPLES: list[tuple[str, str, str, callable]] = [
    (
        "cnot",
        "CNOT",
        "Logical CNOT gate via lattice surgery (one of TQEC's canonical examples).",
        lambda: gallery.cnot(),
    ),
    (
        "cz",
        "CZ",
        "Logical CZ gate.",
        lambda: gallery.cz(),
    ),
    (
        "memory",
        "Memory",
        "Single-cube logical memory experiment (Z basis observable).",
        lambda: gallery.memory(),
    ),
    (
        "stability",
        "Stability",
        "Single-cube stability experiment (Z basis observable).",
        lambda: gallery.stability(),
    ),
    (
        "move_rotation",
        "Move + Rotation",
        "Moving and rotating spatial boundaries of a logical qubit.",
        lambda: gallery.move_rotation(),
    ),
    (
        "three_cnots",
        "Three CNOTs",
        "Three logical CNOT gates compressed in spacetime.",
        lambda: gallery.three_cnots(),
    ),
    (
        "steane_encoding",
        "Steane Encoding",
        "Steane code encoding circuit.",
        lambda: gallery.steane_encoding(),
    ),
]


def main() -> None:
    repo_root = Path(__file__).resolve().parent.parent
    out_dir = repo_root / "gui" / "public" / "bgraph-examples"
    out_dir.mkdir(parents=True, exist_ok=True)

    # Clear existing .bgraph files so removed-from-gallery items don't linger.
    for stale in out_dir.glob("*.bgraph"):
        stale.unlink()

    manifest: list[dict[str, str]] = []
    for slug, display_name, description, factory in EXAMPLES:
        graph = factory()
        bgraph_str = write_bgraph(graph)
        filename = f"{slug}.bgraph"
        (out_dir / filename).write_text(bgraph_str)
        manifest.append(
            {"name": display_name, "description": description, "filename": filename}
        )
        print(f"wrote {filename} ({len(bgraph_str)} bytes)")

    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"wrote manifest.json with {len(manifest)} entries")


if __name__ == "__main__":
    main()
