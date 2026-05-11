"""FastAPI router for bgraph (TQEC BlockGraph text format) import/export.

Bgraph is TQEC's plain-text section-based file format introduced in PR #864
(`tqec.interop.bgraph`). It is distinct from `BlockGraph.to_json()`. This module
wraps TQEC's `load_bgraph` / `write_bgraph` for piper-draw scenes.

Round-trip pipeline (lossless on TQEC data — paint, groupId, port rank, port io,
view camera all drop on export by design; see CEO plan D3=A).

::

    EXPORT (piper-draw blocks → bgraph string):
        BlockInput[]
            │  (convert_blocks: classify cubes vs ports, build TQEC-shaped dict
            │   with Z↔Y coord swap via _piper_to_tqec_pos)
            ▼
        graph_dict
            │  (BlockGraph.from_dict — validates kinds, raises on dup port label)
            ▼
        BlockGraph
            │  (BlockGraph.to_bgraph)
            ▼
        bgraph_str

    IMPORT (bgraph string → piper-draw blocks):
        bgraph_str
            │  (size cap + load_bgraph — raises TQECError on malformed)
            ▼
        BlockGraph
            │  (to_dict)
            ▼
        graph_dict
            │  (_tqec_dict_to_piper_blocks: rebuild piper-draw blocks +
            │   port labels, with Y→Z coord swap via _tqec_to_piper_pos)
            ▼
        BlockOutput[], PortLabelOut[]

Sandwich-cube canonicalization (XZX → ZZX for visually-ambiguous types — see
CLAUDE.md "Canonicalisation assumption") is applied on the frontend via
gui/src/utils/daeImport.ts:canonicaliseImportedCubes, reused by the bgraph path.
The backend returns the cube types verbatim as TQEC produced them; the frontend
normalizes and surfaces the count via a toast.

Policy stricter than TQEC's parser:
- Reject empty bgraph on import (TQEC's `load_bgraph` accepts 0-cube graphs).
- Reject empty scene on export.
- Reject duplicate port labels on import (TQEC's `BlockGraph.add_cube` raises
  this naturally; we surface it as a named HTTPException).
- 5 MB text cap and 10k cube+pipe cap (D11).
"""

from __future__ import annotations

import math
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from tqec.computation.block_graph import BlockGraph
from tqec.interop.bgraph import load_bgraph, write_bgraph
from tqec.utils.exceptions import TQECError

# Caps (CEO plan D11). Text cap is bytes; block cap is cubes + pipes combined.
MAX_BGRAPH_BYTES = 5 * 1024 * 1024
MAX_BLOCK_COUNT = 10_000


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class BgraphExportRequest(BaseModel):
    # We re-declare the block input shape rather than importing from server.py
    # to keep this module loadable without triggering server.py's lifespan
    # init (which warms up tqec.gallery).
    blocks: list[BlockInputLocal]
    port_labels: list[PortLabelInputLocal] = []
    scene_name: str | None = None
    # When False (default), the export calls BlockGraph.validate() before
    # writing. A scene with mismatched cube/pipe colors, dangling pipes, or
    # any other structural invariant violation is rejected with 400
    # `bgraph_invalid_graph`. Set True to write a snapshot of an in-progress
    # scene that isn't yet a valid TQEC graph.
    force: bool = False


class BlockInputLocal(BaseModel):
    pos: list[float]
    type: str


class PortLabelInputLocal(BaseModel):
    pos: list[float]
    label: str
    rank: int | None = None


class BgraphExportResponse(BaseModel):
    bgraph: str
    warnings: list[str] = []


class BgraphImportRequest(BaseModel):
    bgraph: str
    mode: Literal["load", "insert"] = "load"


class BlockOutput(BaseModel):
    pos: list[float]
    type: str


class PortLabelOut(BaseModel):
    pos: list[float]
    label: str


class BgraphImportResponse(BaseModel):
    blocks: list[BlockOutput]
    port_labels: list[PortLabelOut]
    mode: Literal["load", "insert"]
    warnings: list[str] = []


# ---------------------------------------------------------------------------
# Coord conversion (mirrors server.py:_piper_to_tqec_pos / _tqec_to_piper_pos)
# ---------------------------------------------------------------------------


def _piper_to_tqec_pos(pos: list[float]) -> tuple[int, int, int]:
    return (round(pos[0] / 3), round(pos[1] / 3), round(pos[2] / 3))


def _tqec_to_piper_pos(tqec_pos: tuple[int, int, int]) -> list[float]:
    return [tqec_pos[0] * 3.0, tqec_pos[1] * 3.0, tqec_pos[2] * 3.0]


def _pipe_endpoints(pos: list[float]) -> tuple[tuple[int, int, int], tuple[int, int, int]]:
    """Return the two TQEC integer cube positions a piper-draw pipe connects."""
    coords = list(pos)
    for i in range(3):
        remainder = coords[i] - 3 * math.floor(coords[i] / 3)
        if abs(remainder - 1) < 0.5:
            lo = math.floor(coords[i] / 3)
            hi = lo + 1
            u = [round(c / 3) for c in coords]
            v = list(u)
            u[i] = lo
            v[i] = hi
            return (tuple(u), tuple(v))  # type: ignore[return-value]
    raise ValueError(f"Invalid pipe position: {pos}")


# These mirror server.py's sets; duplicated here intentionally so this module
# does not import from server.py (avoids triggering the FastAPI lifespan/gallery
# warm-up just by importing the router into tests).
CUBE_TYPES = {"XZZ", "ZXZ", "ZXX", "XXZ", "ZZX", "XZX", "Y"}
PIPE_TYPES = {
    "OZX",
    "OXZ",
    "OZXH",
    "OXZH",
    "ZOX",
    "XOZ",
    "ZOXH",
    "XOZH",
    "ZXO",
    "XZO",
    "ZXOH",
    "XZOH",
}


# ---------------------------------------------------------------------------
# Blocks → BlockGraph dict
# ---------------------------------------------------------------------------


def _blocks_to_graph_dict(
    blocks: list[BlockInputLocal],
    port_labels: list[PortLabelInputLocal],
    scene_name: str,
) -> dict:
    """Convert piper-draw blocks to a TQEC BlockGraph dict.

    Differs from server.py:convert_blocks in one important way: this function
    requires every port endpoint to have a user-supplied label (no fallback to
    auto-renamed `port_{n}`), and raises on duplicate labels. The CEO plan
    chose D8=C (reject loud on both directions); the server-side validation
    path may auto-rename for transparent /api/validate calls, but bgraph
    export refuses to silently rename.
    """
    label_map: dict[tuple[int, int, int], str] = {}
    for p in port_labels:
        if not p.label:
            continue
        label_map[_piper_to_tqec_pos(p.pos)] = p.label

    cubes: list[dict] = []
    cube_positions: set[tuple[int, int, int]] = set()
    for block in blocks:
        if block.type in CUBE_TYPES:
            tqec_pos = _piper_to_tqec_pos(block.pos)
            cubes.append({"position": list(tqec_pos), "kind": block.type, "label": ""})
            cube_positions.add(tqec_pos)

    pipes: list[dict] = []
    used_port_labels: set[str] = set()
    for block in blocks:
        if block.type not in PIPE_TYPES:
            continue
        u, v = _pipe_endpoints(block.pos)
        pipes.append({"u": list(u), "v": list(v), "kind": block.type})
        for endpoint in (u, v):
            if endpoint in cube_positions:
                continue
            label = label_map.get(endpoint)
            if not label:
                # CEO plan D8=C — no silent fallback to port_{n}. The Ports
                # panel must provide a label before export is allowed.
                piper_pos = [endpoint[i] * 3 for i in range(3)]
                raise HTTPException(
                    status_code=400,
                    detail={
                        "code": "bgraph_missing_port_label",
                        "message": (
                            f"Port at piper-draw position {piper_pos} has no label. "
                            "Set a label in the Ports panel before exporting."
                        ),
                    },
                )
            if label in used_port_labels:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "code": "bgraph_dup_port_label",
                        "message": (
                            f"Duplicate port label '{label}'. Fix in Ports panel before exporting."
                        ),
                    },
                )
            used_port_labels.add(label)
            cubes.append({"position": list(endpoint), "kind": "PORT", "label": label})
            cube_positions.add(endpoint)

    return {"name": scene_name or "piper-draw", "cubes": cubes, "pipes": pipes, "ports": {}}


# ---------------------------------------------------------------------------
# BlockGraph dict → blocks (reverse of _blocks_to_graph_dict)
# ---------------------------------------------------------------------------


def _graph_dict_to_blocks(graph_dict: dict) -> tuple[list[BlockOutput], list[PortLabelOut]]:
    """Convert a BlockGraph dict back to piper-draw blocks + port labels.

    Mirror of `_blocks_to_graph_dict` in reverse:
    - Each cube becomes a Block at `_tqec_to_piper_pos(cube.position)` with type =
      cube.kind. PORT cubes don't become blocks (piper-draw represents them
      implicitly via open pipe endpoints) but contribute a PortLabelOut entry.
    - Each pipe becomes a Block at the midpoint of its u and v endpoints, with
      type = pipe.kind.

    Sandwich-cube canonicalization is NOT applied here — the frontend does it
    via `canonicaliseImportedCubes` so DAE and bgraph imports share one rule.
    """
    out_blocks: list[BlockOutput] = []
    port_labels: list[PortLabelOut] = []
    cube_positions: set[tuple[int, int, int]] = set()

    for cube in graph_dict["cubes"]:
        pos_tuple = tuple(cube["position"])
        cube_positions.add(pos_tuple)
        kind = cube["kind"]
        if kind == "PORT":
            port_labels.append(PortLabelOut(pos=_tqec_to_piper_pos(pos_tuple), label=cube["label"]))
        else:
            out_blocks.append(BlockOutput(pos=_tqec_to_piper_pos(pos_tuple), type=kind))

    for pipe in graph_dict["pipes"]:
        u_tqec = tuple(pipe["u"])
        v_tqec = tuple(pipe["v"])
        u_piper = _tqec_to_piper_pos(u_tqec)
        v_piper = _tqec_to_piper_pos(v_tqec)
        # Piper-draw pipes live in the "mod 3 == 1" slot (see
        # gui/src/types/index.ts:isValidPipePos), NOT at the true geometric
        # midpoint. For two cubes adjacent along axis i (differing by 3 in
        # piper-draw coords), the pipe sits at min(u, v)[i] + 1. Other axes
        # match (u[i] == v[i]).
        pipe_pos = list(u_piper)
        for i in range(3):
            if u_piper[i] != v_piper[i]:
                pipe_pos[i] = min(u_piper[i], v_piper[i]) + 1.0
        out_blocks.append(BlockOutput(pos=pipe_pos, type=pipe["kind"]))

    return out_blocks, port_labels


# ---------------------------------------------------------------------------
# Router + endpoints
# ---------------------------------------------------------------------------


bgraph_router = APIRouter()


@bgraph_router.post("/bgraph_export", response_model=BgraphExportResponse)
async def bgraph_export(req: BgraphExportRequest) -> BgraphExportResponse:
    """Export piper-draw blocks as a bgraph string.

    Rejects: empty scene, dup port labels in scene, missing port labels.
    """
    if not req.blocks:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "bgraph_empty",
                "message": "Scene is empty; nothing to export.",
            },
        )

    graph_dict = _blocks_to_graph_dict(req.blocks, req.port_labels, req.scene_name or "")
    try:
        graph = BlockGraph.from_dict(graph_dict)
    except TQECError as e:
        raise HTTPException(
            status_code=400,
            detail={"code": "bgraph_invalid_graph", "message": str(e)},
        ) from e

    # Strict validation by default — guarantees the file we hand the user is a
    # canonical TQEC graph that downstream tools can read AND reason about.
    # `from_dict` catches per-cube schema errors (bad kinds, dup port labels);
    # `validate()` is the graph-level pass that catches mismatched cube/pipe
    # colors, dangling pipes, Y-cube axis conflicts, etc. — same checks
    # /api/validate runs interactively. `force=true` lets the user snapshot an
    # in-progress scene anyway.
    if not req.force:
        try:
            graph.validate()
        except TQECError as e:
            raise HTTPException(
                status_code=400,
                detail={"code": "bgraph_invalid_graph", "message": str(e)},
            ) from e

    # Pass through the user-supplied scene name as the bgraph circuit_name.
    # TQEC's write_bgraph defaults to "circuit" if not provided.
    graph_name = (req.scene_name or "").strip() or "piper-draw scene"
    bgraph_str = write_bgraph(graph, graph_name=graph_name)
    # TQEC hard-codes `source; TQEC.` in the METADATA block. Rewrite it to
    # identify the producer honestly: this file came out of piper-draw, not
    # tqec.gallery or a TQEC notebook. Brittle vs schema bumps; the round-trip
    # test on every shipped gallery example catches that on the next dep bump.
    bgraph_str = bgraph_str.replace("source; TQEC.\n", "source; piper-draw;\n", 1)
    return BgraphExportResponse(bgraph=bgraph_str)


@bgraph_router.post("/bgraph_import", response_model=BgraphImportResponse)
async def bgraph_import(req: BgraphImportRequest) -> BgraphImportResponse:
    """Import a bgraph string into piper-draw blocks.

    Rejects: text > 5 MB, > 10k blocks total, empty graph, malformed bgraph,
    duplicate port labels.
    """
    if len(req.bgraph.encode("utf-8")) > MAX_BGRAPH_BYTES:
        raise HTTPException(
            status_code=413,
            detail={
                "code": "bgraph_too_large",
                "message": f"Bgraph exceeds {MAX_BGRAPH_BYTES // (1024 * 1024)} MB cap.",
            },
        )

    try:
        graph = load_bgraph(req.bgraph)
    except TQECError as e:
        raise HTTPException(
            status_code=400,
            detail={"code": "bgraph_parse_error", "message": str(e)},
        ) from e

    if len(graph.cubes) == 0:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "bgraph_empty",
                "message": "Bgraph contains no cubes; import rejected.",
            },
        )

    if len(graph.cubes) + len(graph.pipes) > MAX_BLOCK_COUNT:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "bgraph_too_large",
                "message": (
                    f"Bgraph has {len(graph.cubes) + len(graph.pipes)} blocks; "
                    f"max is {MAX_BLOCK_COUNT}."
                ),
            },
        )

    # BlockGraph.add_cube enforces port-label uniqueness; load_bgraph does NOT.
    # Walk ports manually so a hand-edited bgraph with dup port labels is
    # rejected with a clear error rather than passing through silently.
    seen_labels: set[str] = set()
    for cube in graph.cubes:
        if cube.is_port:
            if cube.label in seen_labels:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "code": "bgraph_dup_port_label",
                        "message": f"Duplicate port label '{cube.label}' in bgraph.",
                    },
                )
            seen_labels.add(cube.label)

    graph_dict = graph.to_dict()
    blocks, port_labels = _graph_dict_to_blocks(graph_dict)
    return BgraphImportResponse(
        blocks=blocks,
        port_labels=port_labels,
        mode=req.mode,
    )


# Pydantic v2 forward-reference fix-up for BgraphExportRequest's nested models.
BgraphExportRequest.model_rebuild()
