import asyncio

import pytest

from server import (
    BlockInput,
    PortLabelInput,
    ValidateRequest,
    ZXRequest,
    _pipe_endpoints,
    _piper_to_tqec_pos,
    _tqec_to_piper_pos,
    convert_blocks,
    validate,
    zx,
)


class TestPiperToTqecPos:
    def test_origin(self):
        assert _piper_to_tqec_pos([0, 0, 0]) == (0, 0, 0)

    def test_positive(self):
        assert _piper_to_tqec_pos([3, 6, 9]) == (1, 2, 3)

    def test_negative(self):
        assert _piper_to_tqec_pos([-3, -6, 0]) == (-1, -2, 0)

    def test_floats_round(self):
        assert _piper_to_tqec_pos([3.0, 0.0, 0.0]) == (1, 0, 0)


class TestTqecToPiperPos:
    def test_roundtrip(self):
        for pos in [(0, 0, 0), (1, 2, 3), (-1, -2, 0)]:
            piper = _tqec_to_piper_pos(pos)
            assert _piper_to_tqec_pos(piper) == pos


class TestPipeEndpoints:
    def test_x_axis_pipe(self):
        # Pipe at piper (1, 0, 0) connects tqec (0,0,0) and (1,0,0)
        u, v = _pipe_endpoints([1, 0, 0])
        assert u == (0, 0, 0)
        assert v == (1, 0, 0)

    def test_y_axis_pipe(self):
        u, v = _pipe_endpoints([0, 1, 0])
        assert u == (0, 0, 0)
        assert v == (0, 1, 0)

    def test_z_axis_pipe(self):
        u, v = _pipe_endpoints([0, 0, 1])
        assert u == (0, 0, 0)
        assert v == (0, 0, 1)

    def test_offset_pipe(self):
        # Pipe at piper (4, 3, 0): x=4 has remainder 1 (mod 3), y=3 -> 1, z=0 -> 0
        # x-axis: 4 = 3*1 + 1, so lo=1, hi=2
        u, v = _pipe_endpoints([4, 3, 0])
        assert u == (1, 1, 0)
        assert v == (2, 1, 0)

    def test_negative_pipe(self):
        # Pipe at piper (-2, 0, 0): -2 has remainder 1 (mod 3)
        # since -2 - 3*floor(-2/3) = -2 - 3*(-1) = 1
        u, v = _pipe_endpoints([-2, 0, 0])
        assert u == (-1, 0, 0)
        assert v == (0, 0, 0)

    def test_invalid_position_raises(self):
        with pytest.raises(ValueError, match="Invalid pipe position"):
            _pipe_endpoints([0, 0, 0])

    def test_invalid_position_block_raises(self):
        with pytest.raises(ValueError, match="Invalid pipe position"):
            _pipe_endpoints([3, 3, 3])


class TestConvertBlocks:
    def test_cubes_only(self):
        blocks = [
            BlockInput(pos=[0, 0, 0], type="ZXZ"),
            BlockInput(pos=[3, 0, 0], type="XZZ"),
        ]
        result = convert_blocks(blocks)
        assert len(result["cubes"]) == 2
        assert len(result["pipes"]) == 0
        assert result["cubes"][0]["position"] == [0, 0, 0]
        assert result["cubes"][0]["kind"] == "ZXZ"
        assert result["cubes"][1]["position"] == [1, 0, 0]

    def test_pipe_with_cubes(self):
        blocks = [
            BlockInput(pos=[0, 0, 0], type="ZXZ"),
            BlockInput(pos=[3, 0, 0], type="ZXZ"),
            BlockInput(pos=[1, 0, 0], type="OXZ"),
        ]
        result = convert_blocks(blocks)
        assert len(result["cubes"]) == 2
        assert len(result["pipes"]) == 1
        assert result["pipes"][0]["u"] == [0, 0, 0]
        assert result["pipes"][0]["v"] == [1, 0, 0]
        assert result["pipes"][0]["kind"] == "OXZ"

    def test_auto_port_insertion(self):
        # Pipe with no cube on one end -> Port auto-inserted
        blocks = [
            BlockInput(pos=[0, 0, 0], type="ZXZ"),
            BlockInput(pos=[1, 0, 0], type="OXZ"),
        ]
        result = convert_blocks(blocks)
        cubes = result["cubes"]
        assert len(cubes) == 2  # original cube + auto port
        port = [c for c in cubes if c["kind"] == "PORT"]
        assert len(port) == 1
        assert port[0]["position"] == [1, 0, 0]

    def test_auto_port_both_ends(self):
        # Standalone pipe with no cubes at all
        blocks = [BlockInput(pos=[1, 0, 0], type="OZX")]
        result = convert_blocks(blocks)
        cubes = result["cubes"]
        ports = [c for c in cubes if c["kind"] == "PORT"]
        assert len(ports) == 2
        positions = {tuple(p["position"]) for p in ports}
        assert positions == {(0, 0, 0), (1, 0, 0)}

    def test_auto_port_unique_labels(self):
        blocks = [BlockInput(pos=[1, 0, 0], type="OZX")]
        result = convert_blocks(blocks)
        labels = [c["label"] for c in result["cubes"] if c["kind"] == "PORT"]
        assert len(labels) == len(set(labels))

    def test_no_duplicate_ports(self):
        # Two pipes sharing an endpoint that has no cube -> only one Port
        blocks = [
            BlockInput(pos=[0, 0, 0], type="ZXZ"),
            BlockInput(pos=[1, 0, 0], type="OXZ"),
            BlockInput(pos=[0, 1, 0], type="XOZ"),
        ]
        result = convert_blocks(blocks)
        ports = [c for c in result["cubes"] if c["kind"] == "PORT"]
        # (1,0,0) from first pipe, (0,1,0) from second pipe
        assert len(ports) == 2

    def test_y_block(self):
        blocks = [BlockInput(pos=[0, 0, 0], type="Y")]
        result = convert_blocks(blocks)
        assert result["cubes"][0]["kind"] == "Y"

    def test_hadamard_pipe(self):
        blocks = [
            BlockInput(pos=[0, 0, 0], type="ZXZ"),
            BlockInput(pos=[3, 0, 0], type="ZXZ"),
            BlockInput(pos=[1, 0, 0], type="OXZH"),
        ]
        result = convert_blocks(blocks)
        assert result["pipes"][0]["kind"] == "OXZH"

    def test_unknown_type_ignored(self):
        blocks = [BlockInput(pos=[0, 0, 0], type="UNKNOWN")]
        result = convert_blocks(blocks)
        assert len(result["cubes"]) == 0
        assert len(result["pipes"]) == 0


class TestValidateEndpoint:
    def _run(self, blocks: list[BlockInput]) -> dict:
        resp = asyncio.run(validate(ValidateRequest(blocks=blocks)))
        return {
            "valid": resp.valid,
            "errors": [{"position": e.position, "message": e.message} for e in resp.errors],
        }

    def test_empty_diagram(self):
        result = self._run([])
        assert result["valid"] is True
        assert result["errors"] == []

    def test_valid_two_cubes_with_pipe(self):
        result = self._run(
            [
                BlockInput(pos=[0, 0, 0], type="ZXZ"),
                BlockInput(pos=[3, 0, 0], type="ZXZ"),
                BlockInput(pos=[1, 0, 0], type="OXZ"),
            ]
        )
        assert result["valid"] is True

    def test_mismatched_pipe_colors(self):
        result = self._run(
            [
                BlockInput(pos=[0, 0, 0], type="ZXZ"),
                BlockInput(pos=[3, 0, 0], type="ZXZ"),
                BlockInput(pos=[1, 0, 0], type="OZX"),  # wrong colors for ZXZ
            ]
        )
        assert result["valid"] is False
        assert len(result["errors"]) > 0
        assert "mismatched colors" in result["errors"][0]["message"]

    def test_error_positions_in_piper_coords(self):
        result = self._run(
            [
                BlockInput(pos=[0, 0, 0], type="ZXZ"),
                BlockInput(pos=[3, 0, 0], type="ZXZ"),
                BlockInput(pos=[1, 0, 0], type="OZX"),
            ]
        )
        # Errors should reference piper-draw coordinates (multiples of 3), not tqec coords
        for err in result["errors"]:
            if err["position"] is not None:
                assert all(c % 3 == 0 for c in err["position"])

    def test_dangling_pipe_with_port(self):
        # Pipe with only one cube -> auto-port, should still validate
        result = self._run(
            [
                BlockInput(pos=[0, 0, 0], type="ZXZ"),
                BlockInput(pos=[1, 0, 0], type="OXZ"),
            ]
        )
        assert result["valid"] is True

    def test_standalone_pipe(self):
        # Pipe with no cubes at all -> two ports, valid
        result = self._run(
            [
                BlockInput(pos=[1, 0, 0], type="OZX"),
            ]
        )
        assert result["valid"] is True

    def test_y_open_hadamard_pipe_validation(self):
        # Y-open Hadamard pipe connecting XZZ to ZZX should be valid
        result = self._run(
            [
                BlockInput(pos=[0, 0, 0], type="XZZ"),
                BlockInput(pos=[0, 3, 0], type="ZZX"),
                BlockInput(pos=[0, 1, 0], type="XOZH"),
            ]
        )
        assert result["valid"] is True

    def test_collects_all_errors(self):
        # Two cubes with mismatched pipes -> should collect errors from both cubes
        result = self._run(
            [
                BlockInput(pos=[0, 0, 0], type="ZXZ"),
                BlockInput(pos=[3, 0, 0], type="XZZ"),
                BlockInput(pos=[1, 0, 0], type="OZX"),
            ]
        )
        assert result["valid"] is False
        # Should have errors from at least one cube
        assert len(result["errors"]) >= 1

    def test_cubes_only_no_pipes_valid(self):
        # Isolated cubes with no pipes — tqec allows this
        result = self._run(
            [
                BlockInput(pos=[0, 0, 0], type="ZXZ"),
                BlockInput(pos=[3, 0, 0], type="XZZ"),
            ]
        )
        assert result["valid"] is True

    def test_y_block_with_z_pipe(self):
        # Y block should only accept time-like (Z-direction) pipes
        result = self._run(
            [
                BlockInput(pos=[0, 0, 0], type="Y"),
                BlockInput(pos=[0, 0, 1], type="ZXO"),  # Z-axis pipe
            ]
        )
        assert result["valid"] is True

    def test_y_block_with_x_pipe_invalid(self):
        # Y block with spatial pipe should fail
        result = self._run(
            [
                BlockInput(pos=[0, 0, 0], type="Y"),
                BlockInput(pos=[1, 0, 0], type="OZX"),  # X-axis pipe
            ]
        )
        assert result["valid"] is False

    def test_graph_build_error_returns_null_position(self):
        # Duplicate cubes at same position -> graph build error
        result = self._run(
            [
                BlockInput(pos=[0, 0, 0], type="ZXZ"),
                BlockInput(pos=[0, 0, 0], type="XZZ"),
            ]
        )
        assert result["valid"] is False
        assert result["errors"][0]["position"] is None


class TestZXEndpoint:
    def _run(self, req: ZXRequest) -> dict:
        resp = asyncio.run(zx(req))
        return {
            "ok": resp.ok,
            "vertices": [v.model_dump() for v in resp.vertices],
            "edges": [e.model_dump() for e in resp.edges],
            "qgraph": resp.qgraph,
            "simplified": resp.simplified,
            "circuit": resp.circuit.model_dump() if resp.circuit else None,
            "circuit_error": resp.circuit_error,
            "error": resp.error,
        }

    def test_empty_diagram(self):
        result = self._run(ZXRequest(blocks=[]))
        assert result["ok"] is False
        assert result["error"] == "Empty diagram"

    def test_two_cubes_one_pipe(self):
        # Two ZXZ cubes joined by an X-open pipe -> two X-spiders + one simple edge
        result = self._run(
            ZXRequest(
                blocks=[
                    BlockInput(pos=[0, 0, 0], type="ZXZ"),
                    BlockInput(pos=[3, 0, 0], type="ZXZ"),
                    BlockInput(pos=[1, 0, 0], type="OXZ"),
                ]
            )
        )
        assert result["ok"] is True
        assert result["error"] is None
        kinds = sorted(v["kind"] for v in result["vertices"])
        assert kinds == ["X", "X"]
        assert len(result["edges"]) == 1
        assert result["edges"][0]["hadamard"] is False
        assert result["qgraph"]

    def test_hadamard_pipe_produces_hadamard_edge(self):
        result = self._run(
            ZXRequest(
                blocks=[
                    BlockInput(pos=[0, 0, 0], type="XZZ"),
                    BlockInput(pos=[0, 3, 0], type="ZZX"),
                    BlockInput(pos=[0, 1, 0], type="XOZH"),
                ]
            )
        )
        assert result["ok"] is True
        assert len(result["edges"]) == 1
        assert result["edges"][0]["hadamard"] is True

    def test_port_label_propagates(self):
        # Open-ended pipe creates a port at piper (-3,0,0); label it "in"
        result = self._run(
            ZXRequest(
                blocks=[
                    BlockInput(pos=[0, 0, 0], type="ZXZ"),
                    BlockInput(pos=[-2, 0, 0], type="OXZ"),
                ],
                port_labels=[PortLabelInput(pos=[-3, 0, 0], label="in")],
            )
        )
        assert result["ok"] is True
        boundary_labels = [v["label"] for v in result["vertices"] if v["kind"] == "BOUNDARY"]
        assert boundary_labels == ["in"]

    def test_simplify_reduces_graph(self):
        # Two cubes + one pipe: full_reduce fuses the two X-spiders (both phase 0)
        blocks = [
            BlockInput(pos=[0, 0, 0], type="ZXZ"),
            BlockInput(pos=[3, 0, 0], type="ZXZ"),
            BlockInput(pos=[1, 0, 0], type="OXZ"),
        ]
        raw = self._run(ZXRequest(blocks=blocks, simplify=False))
        simplified = self._run(ZXRequest(blocks=blocks, simplify=True))
        assert simplified["ok"] is True
        assert simplified["simplified"] is True
        assert len(simplified["vertices"]) <= len(raw["vertices"])

    def test_invalid_diagram_returns_error(self):
        # Mismatched pipe colors -> tqec validation error surfaces
        result = self._run(
            ZXRequest(
                blocks=[
                    BlockInput(pos=[0, 0, 0], type="ZXZ"),
                    BlockInput(pos=[3, 0, 0], type="ZXZ"),
                    BlockInput(pos=[1, 0, 0], type="OZX"),
                ]
            )
        )
        assert result["ok"] is False
        assert result["error"] is not None
        assert "Cannot compute ZX graph" in result["error"]

    def test_qgraph_roundtrips_through_pyzx(self):
        import pyzx

        result = self._run(
            ZXRequest(
                blocks=[
                    BlockInput(pos=[0, 0, 0], type="ZXZ"),
                    BlockInput(pos=[3, 0, 0], type="ZXZ"),
                    BlockInput(pos=[1, 0, 0], type="OXZ"),
                ]
            )
        )
        g = pyzx.Graph.from_json(result["qgraph"])
        assert g.num_vertices() == len(result["vertices"])
        assert g.num_edges() == len(result["edges"])

    def test_simplify_normalises_layout(self):
        # After full_reduce + normalize() every surviving vertex should have
        # a meaningful (qubit, row); the backend projects that to pos.
        result = self._run(
            ZXRequest(
                blocks=[
                    BlockInput(pos=[0, 0, 0], type="ZXZ"),
                    BlockInput(pos=[-2, 0, 0], type="OXZ"),
                    BlockInput(pos=[1, 0, 0], type="OXZ"),
                ],
                port_labels=[
                    PortLabelInput(pos=[-3, 0, 0], label="a"),
                    PortLabelInput(pos=[3, 0, 0], label="b"),
                ],
                port_io={"a": "in", "b": "out"},
                simplify=True,
            )
        )
        assert result["ok"] is True
        # Every vertex placed (no nulls) — proves normalize ran.
        assert all(v["pos"] is not None for v in result["vertices"])

    def test_extract_circuit_returns_qasm(self):
        # a -> ZXZ -> b chain: extract_circuit should produce a 1-qubit circuit.
        result = self._run(
            ZXRequest(
                blocks=[
                    BlockInput(pos=[0, 0, 0], type="ZXZ"),
                    BlockInput(pos=[-2, 0, 0], type="OXZ"),
                    BlockInput(pos=[1, 0, 0], type="OXZ"),
                ],
                port_labels=[
                    PortLabelInput(pos=[-3, 0, 0], label="a"),
                    PortLabelInput(pos=[3, 0, 0], label="b"),
                ],
                port_io={"a": "in", "b": "out"},
                simplify=True,
                extract=True,
            )
        )
        assert result["ok"] is True
        assert result["circuit_error"] is None
        assert result["circuit"] is not None
        assert result["circuit"]["qubits"] >= 1
        assert "OPENQASM" in result["circuit"]["qasm"]
        # Structured gate list is populated for the circuit drawer.
        assert isinstance(result["circuit"]["gates"], list)
        for gate in result["circuit"]["gates"]:
            assert isinstance(gate["name"], str)
            assert isinstance(gate["qubits"], list)
            assert all(isinstance(q, int) for q in gate["qubits"])

    def test_extract_without_simplify_errors(self):
        result = self._run(
            ZXRequest(
                blocks=[
                    BlockInput(pos=[0, 0, 0], type="ZXZ"),
                    BlockInput(pos=[-2, 0, 0], type="OXZ"),
                    BlockInput(pos=[1, 0, 0], type="OXZ"),
                ],
                port_labels=[
                    PortLabelInput(pos=[-3, 0, 0], label="a"),
                    PortLabelInput(pos=[3, 0, 0], label="b"),
                ],
                port_io={"a": "in", "b": "out"},
                simplify=False,
                extract=True,
            )
        )
        assert result["ok"] is True
        assert result["circuit"] is None
        assert "requires simplification" in (result["circuit_error"] or "")

    def test_extract_cnot_template_is_single_cx(self):
        # Regression for pyzx.extract_circuit producing a leading HH pair on
        # the control line of tqec.gallery.cnot(). After basic_optimization,
        # the whole circuit should collapse to a single CNOT and contain no
        # consecutive H gates on the same qubit.
        import tqec.gallery

        bg = tqec.gallery.cnot()
        blocks: list[BlockInput] = []
        for cube in bg.cubes:
            if cube.is_port:
                continue
            blocks.append(
                BlockInput(
                    pos=list(_tqec_to_piper_pos(cube.position.as_tuple())),
                    type=str(cube.kind),
                )
            )
        for pipe in bg.pipes:
            up = _tqec_to_piper_pos(pipe.u.position.as_tuple())
            vp = _tqec_to_piper_pos(pipe.v.position.as_tuple())
            blocks.append(
                BlockInput(
                    pos=[(a + b) // 2 for a, b in zip(up, vp)],
                    type=str(pipe.kind),
                )
            )
        port_labels = [
            PortLabelInput(
                pos=list(_tqec_to_piper_pos(c.position.as_tuple())),
                label=c.label,
            )
            for c in bg.cubes
            if c.is_port
        ]
        ports_sorted = sorted((c for c in bg.cubes if c.is_port), key=lambda c: c.position.z)
        port_io = {c.label: ("in" if i < 2 else "out") for i, c in enumerate(ports_sorted)}

        result = self._run(
            ZXRequest(
                blocks=blocks,
                port_labels=port_labels,
                port_io=port_io,
                simplify=True,
                extract=True,
            )
        )
        assert result["ok"] is True, result
        assert result["circuit_error"] is None, result["circuit_error"]
        gates = result["circuit"]["gates"]
        names = [g["name"] for g in gates]
        # Core assertion: no redundant HH pair on the same qubit.
        for i in range(len(gates) - 1):
            same_qubit = gates[i]["qubits"] == gates[i + 1]["qubits"]
            both_h = names[i] == "HAD" and names[i + 1] == "HAD"
            assert not (same_qubit and both_h), f"consecutive Hs remain: {names}"
        # A well-optimized CNOT collapses to a single CX / CNOT gate.
        assert names in (["CNOT"], ["CX"]), f"expected single CX, got {names}"

    def test_extract_returns_qc_and_qsim_formats(self):
        # The unified export UX offers .qasm / .qc / .qsim / .qgraph. The
        # backend is responsible for emitting qc (via pyzx.Circuit.to_qc)
        # and qsim (via the custom basic-gate emitter) alongside qasm.
        result = self._run(
            ZXRequest(
                blocks=[
                    BlockInput(pos=[0, 0, 0], type="ZXZ"),
                    BlockInput(pos=[-2, 0, 0], type="OXZ"),
                    BlockInput(pos=[1, 0, 0], type="OXZ"),
                ],
                port_labels=[
                    PortLabelInput(pos=[-3, 0, 0], label="a"),
                    PortLabelInput(pos=[3, 0, 0], label="b"),
                ],
                port_io={"a": "in", "b": "out"},
                simplify=True,
                extract=True,
            )
        )
        assert result["ok"] is True
        c = result["circuit"]
        assert c is not None
        # .qc is the Quipper-style ASCII circuit format.
        assert "BEGIN" in c["qc"] and "END" in c["qc"]
        # qsim format: first line is qubit count, subsequent lines start with
        # a time index. Every line (after the header) should begin with a
        # non-negative integer followed by a gate name.
        lines = [ln for ln in c["qsim"].strip().splitlines() if ln]
        assert lines, "qsim output is empty"
        assert lines[0].isdigit(), f"first line should be qubit count: {lines[0]!r}"
        for ln in lines[1:]:
            parts = ln.split()
            assert parts[0].isdigit(), f"expected time index in {ln!r}"
            # Gate name should be one of the ones the emitter handles.
            assert parts[1] in {
                "h",
                "x",
                "z",
                "s",
                "t",
                "rx",
                "ry",
                "rz",
                "cx",
                "cz",
                "swap",
            }, f"unexpected qsim gate: {parts[1]!r} in {ln!r}"

    def test_extract_cnot_verified_and_displayed_as_circuit(self):
        # After extract+basic_optimization on the CNOT template:
        #   - the displayed ZX graph should be c.to_graph() (the optimized
        #     circuit's graph), not the pre-extract simplified graph;
        #   - `verified` should be True (compare_tensors(original, c.to_graph())).
        import tqec.gallery

        bg = tqec.gallery.cnot()
        blocks: list[BlockInput] = []
        for cube in bg.cubes:
            if cube.is_port:
                continue
            blocks.append(
                BlockInput(
                    pos=list(_tqec_to_piper_pos(cube.position.as_tuple())),
                    type=str(cube.kind),
                )
            )
        for pipe in bg.pipes:
            up = _tqec_to_piper_pos(pipe.u.position.as_tuple())
            vp = _tqec_to_piper_pos(pipe.v.position.as_tuple())
            blocks.append(
                BlockInput(
                    pos=[(a + b) // 2 for a, b in zip(up, vp)],
                    type=str(pipe.kind),
                )
            )
        port_labels = [
            PortLabelInput(
                pos=list(_tqec_to_piper_pos(c.position.as_tuple())),
                label=c.label,
            )
            for c in bg.cubes
            if c.is_port
        ]
        ports_sorted = sorted((c for c in bg.cubes if c.is_port), key=lambda c: c.position.z)
        port_io = {c.label: ("in" if i < 2 else "out") for i, c in enumerate(ports_sorted)}

        result = self._run(
            ZXRequest(
                blocks=blocks,
                port_labels=port_labels,
                port_io=port_io,
                simplify=True,
                extract=True,
            )
        )
        assert result["ok"] is True
        assert result["circuit"] is not None
        # Verification should succeed: 2 qubits is well within VERIFY_QUBIT_LIMIT.
        assert result["circuit"]["verified"] is True, result["circuit"]
        assert result["circuit"]["verification_error"] is None

        # The displayed graph is the one derived from the optimized circuit,
        # which for a single CNOT is 6 vertices (2 input boundaries, 2 spiders,
        # 2 output boundaries). If we were still displaying pzx.g after
        # full_reduce+normalize we'd see a different (typically larger) vertex
        # count for the CNOT template.
        assert len(result["vertices"]) == 6
        kinds = sorted(v["kind"] for v in result["vertices"])
        assert kinds == ["BOUNDARY", "BOUNDARY", "BOUNDARY", "BOUNDARY", "X", "Z"]

    def test_extract_preserves_port_labels_on_circuit_graph(self):
        # When we swap the displayed graph to the extracted circuit, port
        # labels should still attach to the correct input/output boundaries
        # (mapped by qubit index, not by original vertex id).
        result = self._run(
            ZXRequest(
                blocks=[
                    BlockInput(pos=[0, 0, 0], type="ZXZ"),
                    BlockInput(pos=[-2, 0, 0], type="OXZ"),
                    BlockInput(pos=[1, 0, 0], type="OXZ"),
                ],
                port_labels=[
                    PortLabelInput(pos=[-3, 0, 0], label="a"),
                    PortLabelInput(pos=[3, 0, 0], label="b"),
                ],
                port_io={"a": "in", "b": "out"},
                simplify=True,
                extract=True,
            )
        )
        assert result["ok"] is True
        labels = {v["label"] for v in result["vertices"] if v["label"]}
        assert labels == {"a", "b"}

    def test_extract_without_outputs_errors(self):
        result = self._run(
            ZXRequest(
                blocks=[
                    BlockInput(pos=[0, 0, 0], type="ZXZ"),
                    BlockInput(pos=[-2, 0, 0], type="OXZ"),
                    BlockInput(pos=[1, 0, 0], type="OXZ"),
                ],
                port_labels=[
                    PortLabelInput(pos=[-3, 0, 0], label="a"),
                    PortLabelInput(pos=[3, 0, 0], label="b"),
                ],
                # All ports default to "in" — no outputs configured.
                simplify=True,
                extract=True,
            )
        )
        assert result["ok"] is True
        assert result["circuit"] is None
        assert "output" in (result["circuit_error"] or "").lower()
