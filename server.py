"""FastAPI server for tqec validation of pipe diagrams."""

from __future__ import annotations

import math

from fastapi import FastAPI
from pydantic import BaseModel
from tqec.computation.block_graph import BlockGraph
from tqec.utils.exceptions import TQECError

app = FastAPI()


def _port_key(tqec_pos: tuple[int, int, int]) -> str:
    """Key used to match a port position to a caller-supplied label."""
    return f"{tqec_pos[0]},{tqec_pos[1]},{tqec_pos[2]}"


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


class BlockInput(BaseModel):
    pos: list[float]
    type: str


class PortLabelInput(BaseModel):
    pos: list[float]
    label: str


class ValidateRequest(BaseModel):
    blocks: list[BlockInput]


class ValidationError(BaseModel):
    position: list[float] | None
    message: str


class ValidateResponse(BaseModel):
    valid: bool
    errors: list[ValidationError]


class FlowsRequest(BaseModel):
    blocks: list[BlockInput]
    port_labels: list[PortLabelInput] = []
    port_io: dict[str, str] = {}


class Flow(BaseModel):
    inputs: dict[str, str]
    outputs: dict[str, str]


class FlowsResponse(BaseModel):
    ok: bool
    ordered_ports: list[str]
    inputs: list[str]
    outputs: list[str]
    flows: list[Flow]
    error: str | None = None


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


def convert_blocks(
    blocks: list[BlockInput],
    port_labels: dict[str, str] | None = None,
) -> dict:
    """Convert piper-draw blocks to a tqec BlockGraph dict.

    Pipes in piper-draw whose endpoints don't have a cube get an automatic
    Port inserted — in tqec, every pipe endpoint must be a cube node, and
    an open-ended pipe represents a logical qubit input/output (Port).

    ``port_labels`` maps a tqec-position key (see ``_port_key``) to a caller-
    supplied label. Any unmapped port gets a fallback ``port_{n}`` name.
    """
    port_labels = port_labels or {}
    cubes: list[dict] = []
    pipes: list[dict] = []

    cube_positions: set[tuple[int, int, int]] = set()
    for block in blocks:
        if block.type in CUBE_TYPES:
            tqec_pos = _piper_to_tqec_pos(block.pos)
            cubes.append(
                {
                    "position": list(tqec_pos),
                    "kind": block.type,
                    "label": "",
                }
            )
            cube_positions.add(tqec_pos)

    port_counter = 0
    used_labels: set[str] = set()
    for block in blocks:
        if block.type not in PIPE_TYPES:
            continue
        u, v = _pipe_endpoints(block.pos)
        pipes.append(
            {
                "u": list(u),
                "v": list(v),
                "kind": block.type,
            }
        )
        for endpoint in (u, v):
            if endpoint not in cube_positions:
                label = port_labels.get(_port_key(endpoint))
                if not label or label in used_labels:
                    while True:
                        fallback = f"port_{port_counter}"
                        port_counter += 1
                        if fallback not in used_labels and fallback not in port_labels.values():
                            label = fallback
                            break
                used_labels.add(label)
                cubes.append(
                    {
                        "position": list(endpoint),
                        "kind": "PORT",
                        "label": label,
                    }
                )
                cube_positions.add(endpoint)

    return {"name": "piper-draw", "cubes": cubes, "pipes": pipes, "ports": {}}


def _build_port_label_map(port_labels: list[PortLabelInput]) -> dict[str, str]:
    return {_port_key(_piper_to_tqec_pos(p.pos)): p.label for p in port_labels if p.label}


@app.post("/api/validate")
async def validate(req: ValidateRequest) -> ValidateResponse:
    if not req.blocks:
        return ValidateResponse(valid=True, errors=[])

    try:
        graph_dict = convert_blocks(req.blocks)
        graph = BlockGraph.from_dict(graph_dict)
    except (TQECError, ValueError, KeyError) as e:
        return ValidateResponse(
            valid=False,
            errors=[ValidationError(position=None, message=f"Failed to build graph: {e}")],
        )

    # Validate per-cube to collect all errors (not just the first)
    errors: list[ValidationError] = []
    for cube in graph.cubes:
        try:
            graph._validate_locally_at_cube(cube)
        except TQECError as e:
            piper_pos = _tqec_to_piper_pos(cube.position.as_tuple())
            errors.append(ValidationError(position=piper_pos, message=str(e)))

    return ValidateResponse(valid=len(errors) == 0, errors=errors)


@app.post("/api/flows")
async def flows(req: FlowsRequest) -> FlowsResponse:
    if not req.blocks:
        return FlowsResponse(
            ok=False,
            ordered_ports=[],
            inputs=[],
            outputs=[],
            flows=[],
            error="Empty diagram",
        )

    try:
        label_map = _build_port_label_map(req.port_labels)
        graph_dict = convert_blocks(req.blocks, label_map)
        graph = BlockGraph.from_dict(graph_dict)
        graph.validate()
    except (TQECError, ValueError, KeyError) as e:
        return FlowsResponse(
            ok=False,
            ordered_ports=[],
            inputs=[],
            outputs=[],
            flows=[],
            error=f"Cannot compute flows: {e}",
        )

    ordered_ports = list(graph.ordered_ports)
    if not ordered_ports:
        return FlowsResponse(
            ok=False,
            ordered_ports=[],
            inputs=[],
            outputs=[],
            flows=[],
            error="Diagram has no open ports",
        )

    inputs = [p for p in ordered_ports if req.port_io.get(p, "in") == "in"]
    outputs = [p for p in ordered_ports if req.port_io.get(p, "in") == "out"]

    try:
        surfaces = graph.find_correlation_surfaces()
    except (TQECError, ValueError) as e:
        return FlowsResponse(
            ok=False,
            ordered_ports=ordered_ports,
            inputs=inputs,
            outputs=outputs,
            flows=[],
            error=f"find_correlation_surfaces failed: {e}",
        )

    flows_out: list[Flow] = []
    for surface in surfaces:
        pauli = surface.external_stabilizer_on_graph(graph)
        per_port = dict(zip(ordered_ports, pauli))
        flows_out.append(
            Flow(
                inputs={p: per_port[p] for p in inputs},
                outputs={p: per_port[p] for p in outputs},
            )
        )

    return FlowsResponse(
        ok=True,
        ordered_ports=ordered_ports,
        inputs=inputs,
        outputs=outputs,
        flows=flows_out,
    )
