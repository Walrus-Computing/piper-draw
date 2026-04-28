"""FastAPI server for tqec validation of pipe diagrams."""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import pyzx
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from tqec.computation.block_graph import BlockGraph
from tqec.interop.collada._correlation import CorrelationSurfaceTransformationHelper
from tqec.utils.exceptions import TQECError

# `_correlation` is a private TQEC module but it's the only public surface
# that exposes correlation-surface geometry pieces (unit quads with transforms)
# needed to render flow surfaces in 3D. Pinned via git dep in pyproject.toml.

app = FastAPI()

# Cap on the circuit size we'll run `pyzx.compare_tensors` against for the
# extracted-circuit ≡ original-graph check. Tensor contraction is exponential
# in qubit count, so beyond ~6 qubits the check becomes prohibitively slow.
VERIFY_QUBIT_LIMIT = 6


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
    # User-defined display rank from the Ports table. Lower ranks come first.
    # When provided, the /api/zx endpoint sorts the extracted circuit's qubit
    # register by this value so it matches the order shown in the GUI.
    rank: int | None = None


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


class SurfacePiece(BaseModel):
    basis: str  # "X" or "Z"
    # 4 quad corners in Three.js world coords, flattened as [x0,y0,z0,...,x3,y3,z3]
    vertices: list[float]


class Flow(BaseModel):
    inputs: dict[str, str]
    outputs: dict[str, str]
    surfaces: list[SurfacePiece] = []


class FlowsResponse(BaseModel):
    ok: bool
    ordered_ports: list[str]
    inputs: list[str]
    outputs: list[str]
    flows: list[Flow]
    error: str | None = None


class ZXRequest(BaseModel):
    blocks: list[BlockInput]
    port_labels: list[PortLabelInput] = []
    port_io: dict[str, str] = {}
    simplify: bool = False
    extract: bool = False


class ZXVertex(BaseModel):
    id: int
    kind: str  # "Z" | "X" | "H" | "BOUNDARY"
    phase: str
    pos: list[float] | None
    label: str | None = None


class ZXEdge(BaseModel):
    source: int
    target: int
    hadamard: bool


class ZXGate(BaseModel):
    name: str
    # Qubit indices touched by the gate. For controlled gates, controls come
    # first; the last entry is the target. (Frontend uses this ordering to
    # decide which qubits get a control dot vs. the gate body.)
    qubits: list[int]
    controls: int = 0  # number of leading qubits that act as controls
    phase: str | None = None
    adjoint: bool = False


class ZXCircuit(BaseModel):
    qubits: int
    gate_count: int
    qasm: str
    # Quipper-style .qc (via pyzx.Circuit.to_qc). Empty string if emission failed.
    qc: str = ""
    # Google qsim input format (custom emitter — see `_circuit_to_qsim`). Empty
    # string if any gate in the circuit isn't representable in qsim.
    qsim: str = ""
    gates: list[ZXGate]
    # Semantic-equality check of the extracted+optimized circuit against the
    # pre-simplification ZX graph. `None` means the check was skipped (too many
    # qubits, or the check errored — see `verification_error`).
    verified: bool | None = None
    verification_error: str | None = None


class ZXResponse(BaseModel):
    ok: bool
    vertices: list[ZXVertex]
    edges: list[ZXEdge]
    qgraph: str
    simplified: bool
    circuit: ZXCircuit | None = None
    circuit_error: str | None = None
    error: str | None = None


def _circuit_to_qsim(c) -> str:
    """Emit a Google qsim input description of circuit `c`.

    Format: https://github.com/quantumlib/qsim/blob/master/docs/input_format.md.
    Covers the gate set produced by `pyzx.Circuit.to_basic_gates()`
    (HAD/NOT/Z/S/T/ZPhase/XPhase/YPhase/CNOT/CZ/SWAP). Unknown gates raise
    `ValueError` so callers can surface the failure instead of silently
    emitting a semantically-different circuit.
    """

    def angle_rad(phase) -> float:
        # pyzx phases are Fractions of π (e.g. Fraction(1, 4) == π/4).
        return float(phase) * math.pi

    lines: list[str] = [str(c.qubits)]
    for t, g in enumerate(c.gates):
        name = type(g).__name__
        target = getattr(g, "target", None)
        control = getattr(g, "control", None)
        phase = getattr(g, "phase", None)
        adjoint = bool(getattr(g, "adjoint", False))

        if name == "HAD":
            lines.append(f"{t} h {target}")
        elif name == "NOT":
            lines.append(f"{t} x {target}")
        elif name == "Z":
            lines.append(f"{t} z {target}")
        elif name == "S":
            if adjoint:
                lines.append(f"{t} rz {target} {-math.pi / 2:.10g}")
            else:
                lines.append(f"{t} s {target}")
        elif name == "T":
            if adjoint:
                lines.append(f"{t} rz {target} {-math.pi / 4:.10g}")
            else:
                lines.append(f"{t} t {target}")
        elif name == "ZPhase":
            lines.append(f"{t} rz {target} {angle_rad(phase):.10g}")
        elif name == "XPhase":
            lines.append(f"{t} rx {target} {angle_rad(phase):.10g}")
        elif name == "YPhase":
            lines.append(f"{t} ry {target} {angle_rad(phase):.10g}")
        elif name in ("CNOT", "CX"):
            lines.append(f"{t} cx {control} {target}")
        elif name == "CZ":
            lines.append(f"{t} cz {control} {target}")
        elif name == "SWAP":
            # pyzx stores SWAP endpoints on control / target.
            q1 = control if control is not None else getattr(g, "ctrl1", None)
            q2 = target if target is not None else getattr(g, "ctrl2", None)
            lines.append(f"{t} swap {q1} {q2}")
        else:
            raise ValueError(f"Cannot emit gate '{name}' in qsim format")
    return "\n".join(lines) + "\n"


def _serialize_gate(g) -> ZXGate:
    """Convert a pyzx Gate into a JSON-friendly ZXGate.

    pyzx gates expose `target` and (optionally) `control`, `ctrl1`, `ctrl2`,
    `phase`, `adjoint` as instance attributes. Anything else is gate-specific
    and we don't render it.
    """
    qubits: list[int] = []
    controls = 0
    for attr in ("ctrl1", "ctrl2", "control"):
        v = getattr(g, attr, None)
        if v is not None:
            qubits.append(int(v))
            controls += 1
    target = getattr(g, "target", None)
    if target is not None:
        qubits.append(int(target))
    phase = getattr(g, "phase", None)
    return ZXGate(
        name=type(g).__name__,
        qubits=qubits,
        controls=controls,
        phase=str(phase) if phase is not None else None,
        adjoint=bool(getattr(g, "adjoint", False)),
    )


_ZX_VERTEX_KIND = {
    pyzx.VertexType.BOUNDARY: "BOUNDARY",
    pyzx.VertexType.Z: "Z",
    pyzx.VertexType.X: "X",
    pyzx.VertexType.H_BOX: "H",
}


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


# Basis change from TQEC (X spatial, Y spatial, Z temporal) to Three.js
# (X, Y up, Z out-of-screen). Piper-draw's frontend uses TQEC-X→Three-X,
# TQEC-Y→Three-(-Z), TQEC-Z→Three-Y; see `tqecToThree` in gui/src/types/index.ts.
_TQEC_TO_THREE = np.array(
    [
        [1, 0, 0],
        [0, 0, 1],
        [0, -1, 0],
    ],
    dtype=np.float32,
)


def _quad_vertices_three(basis: str, trans) -> list[float]:  # type: ignore[no-untyped-def]
    """Compute the 4 corner vertices of a correlation-surface quad in Three.js world coords.

    TQEC's helper returns a transform (translation, rotation, scale) that maps a
    unit XY-plane quad (corners at (0,0,0), (1,0,0), (1,1,0), (0,1,0)) to the
    piece's world position in TQEC coords. We apply the transform to the four
    corners, then change basis to Three.js.
    """
    corners = np.array(
        [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
        dtype=np.float32,
    )
    # Scale then rotate then translate, matching the collada convention.
    scaled = corners * trans.scale
    rotated = scaled @ trans.rotation.T
    world_tqec = rotated + trans.translation
    world_three = world_tqec @ _TQEC_TO_THREE.T
    return world_three.flatten().tolist()


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

    # Sort by user-defined rank from the Ports table (matches /api/zx) so the
    # qubit-register position when this diagram is interpreted as a circuit
    # follows the GUI order. Unranked ports fall through to TQEC's
    # alphabetical order.
    label_to_rank: dict[str, int] = {
        p.label: p.rank for p in req.port_labels if p.label and p.rank is not None
    }

    def _flows_sort_key(label: str) -> tuple[int, str]:
        rank = label_to_rank.get(label)
        return (rank if rank is not None else 2**31, label)

    inputs = sorted(
        (p for p in ordered_ports if req.port_io.get(p, "in") == "in"),
        key=_flows_sort_key,
    )
    outputs = sorted(
        (p for p in ordered_ports if req.port_io.get(p, "in") == "out"),
        key=_flows_sort_key,
    )

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

    # `pipe_length=2.0` makes the helper's output positions land on piper-draw's
    # 3-unit grid (cube=1 + pipe=2 per TQEC unit step).
    helper = CorrelationSurfaceTransformationHelper(graph, pipe_length=2.0)

    flows_out: list[Flow] = []
    for surface in surfaces:
        pauli = surface.external_stabilizer_on_graph(graph)
        per_port = dict(zip(ordered_ports, pauli))
        pieces = helper.get_transformations_for_correlation_surface(surface)
        surface_out = [
            SurfacePiece(basis=basis.value, vertices=_quad_vertices_three(basis.value, trans))
            for basis, trans in pieces
        ]
        flows_out.append(
            Flow(
                inputs={p: per_port[p] for p in inputs},
                outputs={p: per_port[p] for p in outputs},
                surfaces=surface_out,
            )
        )

    return FlowsResponse(
        ok=True,
        ordered_ports=ordered_ports,
        inputs=inputs,
        outputs=outputs,
        flows=flows_out,
    )


@app.post("/api/zx")
async def zx(req: ZXRequest) -> ZXResponse:
    if not req.blocks:
        return ZXResponse(
            ok=False,
            vertices=[],
            edges=[],
            qgraph="",
            simplified=False,
            error="Empty diagram",
        )

    try:
        label_map = _build_port_label_map(req.port_labels)
        graph_dict = convert_blocks(req.blocks, label_map)
        graph = BlockGraph.from_dict(graph_dict)
        graph.validate()
        pzx = graph.to_zx_graph()
    except (TQECError, ValueError, KeyError) as e:
        return ZXResponse(
            ok=False,
            vertices=[],
            edges=[],
            qgraph="",
            simplified=False,
            error=f"Cannot compute ZX graph: {e}",
        )

    # Port labels are on BlockGraph cubes; resolve each to the pyzx vertex id
    # via PositionedZX.p2v before any simplification rewrites vertex ids.
    port_label_by_vertex: dict[int, str] = {}
    input_vs: list[int] = []
    output_vs: list[int] = []
    for cube in graph.cubes:
        if cube.is_port and cube.position in pzx.p2v:
            v = int(pzx.p2v[cube.position])
            port_label_by_vertex[v] = cube.label
            io = req.port_io.get(cube.label, "in")
            (output_vs if io == "out" else input_vs).append(v)

    # Sort input/output vertex lists by user-defined rank from the Ports table
    # so the extracted circuit's qubit register matches the GUI order.
    # Unranked ports sort last, then alphabetically by label.
    label_to_rank: dict[str, int] = {
        p.label: p.rank for p in req.port_labels if p.label and p.rank is not None
    }

    def _port_sort_key(v: int) -> tuple[int, str]:
        label = port_label_by_vertex.get(v, "")
        rank = label_to_rank.get(label)
        return (rank if rank is not None else 2**31, label)

    input_vs.sort(key=_port_sort_key)
    output_vs.sort(key=_port_sort_key)

    # Register boundary vertices as pyzx inputs/outputs (required by
    # pyzx.extract_circuit, harmless otherwise).
    if input_vs:
        pzx.g.set_inputs(tuple(input_vs))
    if output_vs:
        pzx.g.set_outputs(tuple(output_vs))

    # Snapshot the pre-simplification graph so we can compare it to the
    # extracted+optimized circuit for semantic equivalence.
    original_g = pzx.g.copy() if req.extract else None

    if req.simplify:
        pyzx.simplify.full_reduce(pzx.g)
        # normalize() places inputs/outputs at sensible (qubit, row) — required
        # before extract_circuit and nicer for display. Skip it when only
        # outputs are set: pyzx.normalize() invokes auto_detect_io() whenever
        # num_inputs() == 0, which clobbers our explicit outputs and raises
        # TypeError on boundary vertices that share a row with their neighbor
        # (issue #221). Frontend falls back to a circle layout in that case.
        if pzx.g.num_inputs() > 0 or pzx.g.num_outputs() == 0:
            pzx.g.normalize()

    circuit_info: ZXCircuit | None = None
    circuit_error: str | None = None
    # By default the displayed ZX is pzx.g with the existing label mapping; when
    # extraction succeeds we swap in the graph derived from the optimized circuit
    # so the diagram matches the gate list.
    display_graph = pzx.g
    display_label_map = port_label_by_vertex
    use_circuit_layout = req.simplify
    if req.extract:
        if not req.simplify:
            circuit_error = "Circuit extraction requires simplification (full_reduce)."
        elif not output_vs:
            circuit_error = (
                "Circuit extraction requires at least one port marked as output. "
                "Set a port's direction to 'out' in the Flows panel."
            )
        else:
            try:
                c = pyzx.extract_circuit(pzx.g.copy())
                # Cancel the HH / XX / ZZ pairs and redundant phase gates
                # that extract_circuit routinely inserts at qubit boundaries
                # (e.g. the CNOT template produces a pair of leading Hs on
                # the control line that compose to identity).
                c = pyzx.optimize.basic_optimization(c.to_basic_gates())
                # Already in basic gates, but to_basic_gates is idempotent.
                basic = c.to_basic_gates()

                # Rebuild the displayed ZX from the optimized circuit so the
                # rendered diagram matches the gate list below.
                c_graph = c.to_graph()

                # Carry port labels over to the circuit graph's boundaries by
                # qubit index: circuit qubit i was originally input_vs[i] /
                # output_vs[i] (pyzx preserves the set_inputs/set_outputs order).
                extract_label_map: dict[int, str] = {}
                c_inputs = list(c_graph.inputs())
                c_outputs = list(c_graph.outputs())
                for qi, v in enumerate(c_inputs):
                    if qi < len(input_vs):
                        lbl = port_label_by_vertex.get(input_vs[qi])
                        if lbl:
                            extract_label_map[int(v)] = lbl
                for qi, v in enumerate(c_outputs):
                    if qi < len(output_vs):
                        lbl = port_label_by_vertex.get(output_vs[qi])
                        if lbl:
                            extract_label_map[int(v)] = lbl

                # Verify: does the extracted+optimized circuit represent the
                # same linear map as the pre-simplification graph? Cap at
                # VERIFY_QUBIT_LIMIT because compare_tensors is exponential.
                verified: bool | None = None
                verification_error: str | None = None
                if c.qubits <= VERIFY_QUBIT_LIMIT and original_g is not None:
                    try:
                        verified = bool(pyzx.compare_tensors(original_g, c_graph))
                    except Exception as ve:
                        verification_error = f"compare_tensors failed: {ve}"
                elif c.qubits > VERIFY_QUBIT_LIMIT:
                    verification_error = (
                        f"Skipped: {c.qubits} qubits exceeds tensor-comparison "
                        f"limit of {VERIFY_QUBIT_LIMIT}"
                    )

                # pyzx.to_qc and our qsim emitter can both raise on edge-case
                # gate sets; emit an empty string rather than aborting the
                # whole response so the UI still shows qasm + the diagram.
                try:
                    qc_str = c.to_qc()
                except Exception:
                    qc_str = ""
                try:
                    qsim_str = _circuit_to_qsim(c)
                except Exception:
                    qsim_str = ""

                circuit_info = ZXCircuit(
                    qubits=c.qubits,
                    gate_count=len(basic.gates),
                    qasm=c.to_qasm(),
                    qc=qc_str,
                    qsim=qsim_str,
                    gates=[_serialize_gate(g) for g in basic.gates],
                    verified=verified,
                    verification_error=verification_error,
                )
                display_graph = c_graph
                display_label_map = extract_label_map
                use_circuit_layout = True
            except Exception as e:  # pyzx raises various errors; surface them all
                circuit_error = f"extract_circuit failed: {e}"

    g = display_graph
    vertices: list[ZXVertex] = []
    for v in g.vertices():
        if use_circuit_layout:
            # After full_reduce+normalize (or on the extracted circuit graph)
            # the tqec positions no longer map to surviving vertices; pyzx's
            # (qubit, row) is the meaningful layout. Project row→x, qubit→-z
            # so time flows horizontally.
            q = g.qubit(v)
            r = g.row(v)
            pos_list = [float(r), 0.0, -float(q)] if q != -1 and r != -1 else None
        else:
            pos = pzx.positions.get(v)
            pos_list = [float(pos.x), float(pos.y), float(pos.z)] if pos is not None else None
        vertices.append(
            ZXVertex(
                id=int(v),
                kind=_ZX_VERTEX_KIND.get(pyzx.VertexType(g.type(v)), str(g.type(v))),
                phase=str(g.phase(v)),
                pos=pos_list,
                label=display_label_map.get(int(v)),
            )
        )

    edges: list[ZXEdge] = []
    for e in g.edges():
        u, w = e
        edges.append(
            ZXEdge(
                source=int(u),
                target=int(w),
                hadamard=(g.edge_type(e) == pyzx.EdgeType.HADAMARD),
            )
        )

    return ZXResponse(
        ok=True,
        vertices=vertices,
        edges=edges,
        qgraph=g.to_json(),
        simplified=req.simplify,
        circuit=circuit_info,
        circuit_error=circuit_error,
        error=None,
    )


# Serve the built frontend (if present) at the root. Mounted last so all
# /api/* routes take precedence over the static catch-all.
_DIST = Path(__file__).parent / "gui" / "dist"
if _DIST.is_dir():
    app.mount("/", StaticFiles(directory=_DIST, html=True), name="static")
