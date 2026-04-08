# Changelog

## Unreleased

### Added
- `Block` class (`piper_draw/core/block.py`) with `__slots__`, read-only `coordinates` and `block_type` properties, and `get_face`/`set_face` methods.
- `Face` enum: `NORTH`, `SOUTH`, `EAST`, `WEST`, `TOP`, `BOTTOM`.
- `FaceState` enum: `OPEN`, `BLUE`, `RED`. Default face states: NORTH/SOUTH=RED, EAST/WEST=BLUE, TOP/BOTTOM=OPEN.
- `Block` supports `block_type` of `"regular"` (default) or `"Y"`.
- `networkx>=3.2` dependency.

### Changed
- `PipeDiagram` rewritten from a dataclass to a networkx-backed graph with hidden internals.
- Public API: `add_block`, `remove_block`, `get_block`, `connect_blocks`, `disconnect_blocks`, `neighbors`.
- Properties: `blocks`, `num_blocks`, `num_connections`, `__contains__`.
- `Block`, `Face`, `FaceState`, and `PipeDiagram` all exported from `piper_draw`.

### Removed
- `PipeDiagram.size` and `PipeDiagram.active_voxels` attributes.
