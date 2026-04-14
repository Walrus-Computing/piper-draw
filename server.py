"""FastAPI server for tqec validation of pipe diagrams."""

from __future__ import annotations

import math

from fastapi import FastAPI
from pydantic import BaseModel

from tqec.computation.block_graph import BlockGraph
from tqec.utils.exceptions import TQECError

app = FastAPI()

CUBE_TYPES = {"XZZ", "ZXZ", "ZXX", "XXZ", "ZZX", "XZX", "Y"}
PIPE_TYPES = {
    "OZX", "OXZ", "OZXH", "OXZH",
    "ZOX", "XOZ", "ZOXH", "XOZH",
    "ZXO", "XZO", "ZXOH", "XZOH",
}


class BlockInput(BaseModel):
    pos: list[float]
    type: str


class ValidateRequest(BaseModel):
    blocks: list[BlockInput]


class ValidationError(BaseModel):
    position: list[float] | None
    message: str


class ValidateResponse(BaseModel):
    valid: bool
    errors: list[ValidationError]


def _piper_to_tqec_pos(pos: list[float]) -> tuple[int, int, int]:
    """Convert piper-draw position (3-unit grid) to tqec integer position."""
    return (round(pos[0] / 3), round(pos[1] / 3), round(pos[2] / 3))


def _pipe_endpoints(pos: list[float]) -> tuple[tuple[int, int, int], tuple[int, int, int]]:
    """Derive the two tqec cube positions connected by a pipe at the given piper-draw position.

    A pipe has exactly one coordinate c where c % 3 == 1. The two cubes are at
    floor(c/3) and ceil(c/3) on that axis (i.e. floor(c/3) and floor(c/3)+1).
    """
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


def _tqec_to_piper_pos(tqec_pos: tuple[int, int, int]) -> list[float]:
    """Convert tqec integer position back to piper-draw coordinates."""
    return [float(c * 3) for c in tqec_pos]


def convert_blocks(blocks: list[BlockInput]) -> dict:
    """Convert piper-draw blocks to a tqec BlockGraph dict.

    Pipes in piper-draw whose endpoints don't have a cube get an automatic
    Port inserted — in tqec, every pipe endpoint must be a cube node, and
    an open-ended pipe represents a logical qubit input/output (Port).
    """
    cubes: list[dict] = []
    pipes: list[dict] = []

    # Collect all cube positions first
    cube_positions: set[tuple[int, int, int]] = set()
    for block in blocks:
        if block.type in CUBE_TYPES:
            tqec_pos = _piper_to_tqec_pos(block.pos)
            cubes.append({
                "position": list(tqec_pos),
                "kind": block.type,
                "label": "",
            })
            cube_positions.add(tqec_pos)

    # Process pipes; auto-insert Ports at endpoints missing a cube
    port_counter = 0
    for block in blocks:
        if block.type not in PIPE_TYPES:
            continue
        u, v = _pipe_endpoints(block.pos)
        pipes.append({
            "u": list(u),
            "v": list(v),
            "kind": block.type,
        })
        for endpoint in (u, v):
            if endpoint not in cube_positions:
                cubes.append({
                    "position": list(endpoint),
                    "kind": "PORT",
                    "label": f"port_{port_counter}",
                })
                cube_positions.add(endpoint)
                port_counter += 1

    return {"name": "piper-draw", "cubes": cubes, "pipes": pipes, "ports": {}}


@app.post("/api/validate")
async def validate(req: ValidateRequest) -> ValidateResponse:
    if not req.blocks:
        return ValidateResponse(valid=True, errors=[])

    try:
        graph_dict = convert_blocks(req.blocks)
        graph = BlockGraph.from_dict(graph_dict)
    except (TQECError, ValueError, KeyError) as e:
        return ValidateResponse(valid=False, errors=[
            ValidationError(position=None, message=f"Failed to build graph: {e}")
        ])

    # Validate per-cube to collect all errors (not just the first)
    errors: list[ValidationError] = []
    for cube in graph.cubes:
        try:
            graph._validate_locally_at_cube(cube)
        except TQECError as e:
            piper_pos = _tqec_to_piper_pos(cube.position.as_tuple())
            errors.append(ValidationError(position=piper_pos, message=str(e)))

    return ValidateResponse(valid=len(errors) == 0, errors=errors)
