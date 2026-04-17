"""Generate the bundled .dae template library from tqec.gallery.

Re-run this script if tqec is updated and the bundled templates need refreshing.
The output directory is served statically by Vite at `/templates/<name>.dae`,
and the manifest drives the "Import Template" picker in the toolbar.
"""

from __future__ import annotations

import json
from pathlib import Path

from tqec import gallery

OUT_DIR = Path(__file__).resolve().parents[1] / "piper_draw" / "gui" / "public" / "templates"

# (filename, display name, builder, description)
# tqec.gallery.memory() and gallery.stability() are intentionally omitted: they
# return single-cube graphs (the temporal extent is set at compile time, not in
# the spacetime diagram), so they don't make useful starting templates.
TEMPLATES = [
    ("cnot.dae", "CNOT", gallery.cnot, "Logical CNOT gate."),
    ("cz.dae", "CZ", gallery.cz, "Logical CZ gate."),
    ("move_rotation.dae", "Move + Rotation", gallery.move_rotation, "Patch move and rotation."),
    ("three_cnots.dae", "Three CNOTs", gallery.three_cnots, "Three logical CNOTs in sequence."),
    ("steane_encoding.dae", "Steane Encoding", gallery.steane_encoding, "Steane code encoding circuit compressed in spacetime."),
]


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = []
    for filename, name, builder, description in TEMPLATES:
        graph = builder()
        out_path = OUT_DIR / filename
        graph.to_dae_file(out_path)
        manifest.append({"filename": filename, "name": name, "description": description})
        print(f"wrote {out_path.relative_to(OUT_DIR.parent.parent.parent.parent)}")

    manifest_path = OUT_DIR / "manifest.json"
    manifest_path.write_text(
        json.dumps(
            {
                "source": "Generated from tqec.gallery (https://github.com/tqec/tqec).",
                "regenerate": "python scripts/generate_templates.py",
                "templates": manifest,
            },
            indent=2,
        )
        + "\n"
    )
    print(f"wrote {manifest_path.relative_to(OUT_DIR.parent.parent.parent.parent)}")


if __name__ == "__main__":
    main()
