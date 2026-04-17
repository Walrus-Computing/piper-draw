import asyncio

import pytest

from server import (
    BlockInput,
    ValidateRequest,
    _pipe_endpoints,
    _piper_to_tqec_pos,
    _tqec_to_piper_pos,
    convert_blocks,
    validate,
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
