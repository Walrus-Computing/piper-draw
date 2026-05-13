# Equiseta example FTQC graphs

Bundled JSON fixtures produced by [Equiseta](https://github.com/Walrus-Computing/equiseta)'s
`FTQCGraph.to_json()` serializer. Loaded by `EquisetaJsonPanel` for inspection
inside the piper-draw GUI.

## Source

These files are copied verbatim from the equiseta repo at:

- Branch: `peter-janderks/ftqcgraph-to-json` (PR #29)
- Source SHA: `f7a63ea47fd50baf6693fedadaa35859f94b94c9`

## Regenerating

Run the sync script from the repo root:

```bash
uv run python scripts/sync_equiseta_examples.py
```

The script reads the source repo URL and SHA from constants at the top of
the file. Re-run it after equiseta merges new examples or changes the JSON
schema.

## Files

| File | Description |
|------|-------------|
| `all_open.json` | Every face OPEN. Minimal connector cube. |
| `all_red.json` | Every face RED. |
| `all_blue.json` | Every face BLUE. |
| `zxx_memory.json` | Surface-code memory cube (Z time-boundary, X space-boundary). |
| `xzz_memory.json` | Opposite-basis memory cube. |
| `hadamard_top.json` | RED bottom and sides, HADAMARD on top. |
| `port_io.json` | RED sides, PORT top and bottom. |
| `y_defect_ridges.json` | Demonstrates all three is_y_defect states (true / false / null). |
| `two_cubes.json` | Two BLUE cubes sharing one OPEN face along the i-axis. |
| `koval_q_couch_cnot.json` | Koval-q couch CNOT gate (10 cubes + 10 pipes + 4 ports). Hand-adjusted for piper-draw compatibility — see note below. |

## koval_q_couch_cnot.json

Sourced from [equiseta@ab3eef9](https://github.com/Walrus-Computing/equiseta/blob/ab3eef945c48d3d3f2aaf376fad8746f44964802/examples/serialization/koval_q_couch_cnot.json) (`examples/serialization/koval_q_couch_cnot.py`).

The equiseta original encodes two "Hadamard junction" cubes at `(0,0,1)` and `(1,1,1)` — both have opposite-face basis colors that disagree (e.g. `BOTTOM=blue, TOP=red`), which piper-draw's cube model can't represent as a single cube. The on-disk fixture here has been hand-adjusted so each cube's opposite faces share a basis. **Topology** (node coordinates, edge list, port placement) is byte-identical to the original; face colors deviate at the Hadamard-junction positions and at the cubes the basis-hint propagation pulls along with them. This file is intentionally **not** in `sync_equiseta_examples.py`'s sync set.

The `manifest.json` in this directory mirrors this list with names and
descriptions, and is fetched by `EquisetaMenu` to populate the dropdown.
