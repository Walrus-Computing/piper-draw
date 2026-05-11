"""Endpoint-level tests for the bgraph router.

Covers all error paths and happy paths for /api/bgraph_export and
/api/bgraph_import. Round-trip and coord-swap parity tests live in
test_bgraph_endpoints_roundtrip.py.
"""

from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException

from bgraph_endpoints import (
    BgraphExportRequest,
    BgraphImportRequest,
    BlockInputLocal,
    PortLabelInputLocal,
    bgraph_export,
    bgraph_import,
)


def _run(coro):
    return asyncio.run(coro)


def _block(pos: list[float], type: str) -> BlockInputLocal:
    return BlockInputLocal(pos=pos, type=type)


def _port_label(pos: list[float], label: str) -> PortLabelInputLocal:
    return PortLabelInputLocal(pos=pos, label=label)


# ---------------------------------------------------------------------------
# bgraph_export
# ---------------------------------------------------------------------------


class TestBgraphExport:
    def test_empty_scene_rejected(self):
        with pytest.raises(HTTPException) as exc_info:
            _run(bgraph_export(BgraphExportRequest(blocks=[])))
        assert exc_info.value.status_code == 400
        assert exc_info.value.detail["code"] == "bgraph_empty"

    def test_single_cube_succeeds(self):
        # One ZXZ cube at piper-draw (0,0,0)
        resp = _run(bgraph_export(BgraphExportRequest(blocks=[_block([0, 0, 0], "ZXZ")])))
        assert resp.bgraph.startswith("BLOCKGRAPH 0.1.0;")
        assert "ZXZ" in resp.bgraph

    def test_metadata_source_is_piper_draw(self):
        # TQEC's write_bgraph emits `source; TQEC.`; we rewrite it on export
        # so the file honestly identifies the producer.
        resp = _run(bgraph_export(BgraphExportRequest(blocks=[_block([0, 0, 0], "ZXZ")])))
        assert "source; piper-draw;" in resp.bgraph
        assert "source; TQEC." not in resp.bgraph

    def test_metadata_circuit_name_uses_scene_name(self):
        # User-supplied scene_name should appear in METADATA circuit_name.
        resp = _run(
            bgraph_export(
                BgraphExportRequest(
                    blocks=[_block([0, 0, 0], "ZXZ")],
                    scene_name="my-circuit",
                )
            )
        )
        assert "circuit_name; my-circuit;" in resp.bgraph

    def test_metadata_circuit_name_default_when_unset(self):
        # Empty/missing scene_name falls back to "piper-draw scene".
        resp = _run(bgraph_export(BgraphExportRequest(blocks=[_block([0, 0, 0], "ZXZ")])))
        assert "circuit_name; piper-draw scene;" in resp.bgraph

    def test_strict_validation_rejects_invalid_graph(self):
        # ZXZ ↔ OZX ↔ ZXX is a known-bad chain: the cube/pipe color mismatch
        # fails BlockGraph.validate() but passes BlockGraph.from_dict().
        # Without strict export validation, this would silently produce a
        # syntactically-valid bgraph that's semantically wrong.
        with pytest.raises(HTTPException) as exc_info:
            _run(
                bgraph_export(
                    BgraphExportRequest(
                        blocks=[
                            _block([0, 0, 0], "ZXZ"),
                            _block([1, 0, 0], "OZX"),
                            _block([3, 0, 0], "ZXX"),
                        ],
                    )
                )
            )
        assert exc_info.value.status_code == 400
        assert exc_info.value.detail["code"] == "bgraph_invalid_graph"
        # The error message should name the problem so the user can fix it.
        assert "mismatched" in exc_info.value.detail["message"].lower()

    def test_force_skips_strict_validation(self):
        # Same invalid scene as above — with force=True the export proceeds
        # so users can snapshot in-progress work.
        resp = _run(
            bgraph_export(
                BgraphExportRequest(
                    blocks=[
                        _block([0, 0, 0], "ZXZ"),
                        _block([1, 0, 0], "OZX"),
                        _block([3, 0, 0], "ZXX"),
                    ],
                    force=True,
                )
            )
        )
        assert resp.bgraph.startswith("BLOCKGRAPH 0.1.0;")

    def test_metadata_circuit_name_whitespace_trimmed(self):
        resp = _run(
            bgraph_export(
                BgraphExportRequest(
                    blocks=[_block([0, 0, 0], "ZXZ")],
                    scene_name="   ",
                )
            )
        )
        assert "circuit_name; piper-draw scene;" in resp.bgraph

    def test_cube_with_pipe_to_labeled_port(self):
        # Cube at (0,0,0), open pipe at (1,0,0) → port at (3,0,0).
        # ZXZ cube (x=Z, y=X, z=Z) + OXZ pipe (y=X, z=Z) is a valid color match.
        resp = _run(
            bgraph_export(
                BgraphExportRequest(
                    blocks=[_block([0, 0, 0], "ZXZ"), _block([1, 0, 0], "OXZ")],
                    port_labels=[_port_label([3, 0, 0], "out_0")],
                )
            )
        )
        assert "PORT" in resp.bgraph
        assert "out_0" in resp.bgraph

    def test_missing_port_label_rejected(self):
        # Open pipe with no label for its un-cubed endpoint.
        with pytest.raises(HTTPException) as exc_info:
            _run(
                bgraph_export(
                    BgraphExportRequest(
                        blocks=[_block([0, 0, 0], "ZXZ"), _block([1, 0, 0], "OZX")],
                        port_labels=[],
                    )
                )
            )
        assert exc_info.value.status_code == 400
        assert exc_info.value.detail["code"] == "bgraph_missing_port_label"

    def test_dup_port_label_rejected_on_export(self):
        # Two open pipes whose un-cubed endpoints both carry label "x".
        # Piper-draw pipes sit in the "mod 3 == 1" slot — the left-side pipe
        # between cubes at piper (-3,0,0) and (0,0,0) lives at piper (-2,0,0).
        with pytest.raises(HTTPException) as exc_info:
            _run(
                bgraph_export(
                    BgraphExportRequest(
                        blocks=[
                            _block([0, 0, 0], "ZXZ"),
                            _block([1, 0, 0], "OZX"),  # right pipe: 0 ↔ 3
                            _block([-2, 0, 0], "OZX"),  # left pipe: -3 ↔ 0
                        ],
                        port_labels=[
                            _port_label([3, 0, 0], "x"),
                            _port_label([-3, 0, 0], "x"),
                        ],
                    )
                )
            )
        assert exc_info.value.status_code == 400
        assert exc_info.value.detail["code"] == "bgraph_dup_port_label"

    def test_pipes_only_no_cubes_emits_port_to_port(self):
        # An OZX pipe at (1,0,0) with both endpoints labeled → two ports + pipe.
        resp = _run(
            bgraph_export(
                BgraphExportRequest(
                    blocks=[_block([1, 0, 0], "OZX")],
                    port_labels=[
                        _port_label([0, 0, 0], "left"),
                        _port_label([3, 0, 0], "right"),
                    ],
                )
            )
        )
        assert "left" in resp.bgraph
        assert "right" in resp.bgraph


# ---------------------------------------------------------------------------
# bgraph_import
# ---------------------------------------------------------------------------


_MINIMAL_BGRAPH = """BLOCKGRAPH 0.1.0;

METADATA: attr_name; value;
source; piper-draw;
circuit_name; test;

CUBES: index;x;y;z;kind;label;
(0, 0, 0);0;0;0;ZXZ;;
(1, 0, 0);1;0;0;PORT;out_0;

PIPES: src;tgt;kind;
(0, 0, 0);(1, 0, 0);OZX;
"""


class TestBgraphImport:
    def test_minimal_succeeds(self):
        resp = _run(bgraph_import(BgraphImportRequest(bgraph=_MINIMAL_BGRAPH)))
        # One ZXZ cube at piper (0,0,0), one OZX pipe at midpoint (1.5,0,0).
        types = {b.type for b in resp.blocks}
        assert "ZXZ" in types
        assert "OZX" in types
        # Port label round-trips.
        assert any(p.label == "out_0" for p in resp.port_labels)

    def test_mode_load_is_default(self):
        resp = _run(bgraph_import(BgraphImportRequest(bgraph=_MINIMAL_BGRAPH)))
        assert resp.mode == "load"

    def test_mode_insert_passes_through(self):
        resp = _run(bgraph_import(BgraphImportRequest(bgraph=_MINIMAL_BGRAPH, mode="insert")))
        assert resp.mode == "insert"

    def test_empty_bgraph_rejected(self):
        empty_bgraph = """BLOCKGRAPH 0.1.0;

METADATA: attr_name; value;
source; piper-draw;
circuit_name; test;

CUBES: index;x;y;z;kind;label;

PIPES: src;tgt;kind;
"""
        with pytest.raises(HTTPException) as exc_info:
            _run(bgraph_import(BgraphImportRequest(bgraph=empty_bgraph)))
        assert exc_info.value.status_code == 400
        assert exc_info.value.detail["code"] == "bgraph_empty"

    def test_malformed_rejected(self):
        with pytest.raises(HTTPException) as exc_info:
            _run(bgraph_import(BgraphImportRequest(bgraph="this is not a bgraph")))
        assert exc_info.value.status_code == 400
        assert exc_info.value.detail["code"] == "bgraph_parse_error"

    def test_size_cap_rejected(self):
        # 6 MB of garbage → 413.
        big = "x" * (6 * 1024 * 1024)
        with pytest.raises(HTTPException) as exc_info:
            _run(bgraph_import(BgraphImportRequest(bgraph=big)))
        assert exc_info.value.status_code == 413
        assert exc_info.value.detail["code"] == "bgraph_too_large"

    def test_dup_port_label_rejected_on_import(self):
        # Hand-crafted bgraph with two PORT cubes sharing a label.
        # Note: BlockGraph.add_cube raises on dup label, so load_bgraph itself
        # surfaces this as TQECError → bgraph_parse_error in our wrapper.
        # Either error code is acceptable for this case (both reject loudly).
        dup_bgraph = """BLOCKGRAPH 0.1.0;

METADATA: attr_name; value;
source; piper-draw;
circuit_name; test;

CUBES: index;x;y;z;kind;label;
(0, 0, 0);0;0;0;ZXZ;;
(1, 0, 0);1;0;0;PORT;x;
(-1, 0, 0);-1;0;0;PORT;x;

PIPES: src;tgt;kind;
(0, 0, 0);(1, 0, 0);OZX;
(-1, 0, 0);(0, 0, 0);OZX;
"""
        with pytest.raises(HTTPException) as exc_info:
            _run(bgraph_import(BgraphImportRequest(bgraph=dup_bgraph)))
        assert exc_info.value.status_code == 400
        assert exc_info.value.detail["code"] in (
            "bgraph_dup_port_label",
            "bgraph_parse_error",
        )

    def test_y_cube_round_trips(self):
        y_bgraph = """BLOCKGRAPH 0.1.0;

METADATA: attr_name; value;
source; piper-draw;
circuit_name; test;

CUBES: index;x;y;z;kind;label;
(0, 0, 0);0;0;0;Y;;

PIPES: src;tgt;kind;
"""
        resp = _run(bgraph_import(BgraphImportRequest(bgraph=y_bgraph)))
        assert any(b.type == "Y" for b in resp.blocks)


# ---------------------------------------------------------------------------
# Coord-conversion symmetry (server.py helpers vs bgraph_endpoints helpers)
# ---------------------------------------------------------------------------


class TestCoordConversionParity:
    """The eng review (E4) chose 100% server-side coord swap. bgraph_endpoints
    duplicates these helpers verbatim from server.py to avoid import cycles.
    This test guards against divergence: if either implementation drifts, the
    round-trip will fail here.
    """

    def test_piper_to_tqec_matches_server(self):
        from bgraph_endpoints import _piper_to_tqec_pos as bgraph_pp
        from server import _piper_to_tqec_pos as server_pp

        for pos in [[0, 0, 0], [3, 6, 9], [-3, 0, 6], [3.0, 0.0, 0.0]]:
            assert server_pp(pos) == bgraph_pp(pos), f"divergence at {pos}"

    def test_tqec_to_piper_matches_server(self):
        from bgraph_endpoints import _tqec_to_piper_pos as bgraph_tp
        from server import _tqec_to_piper_pos as server_tp

        for tqec_pos in [(0, 0, 0), (1, 2, 3), (-1, -2, 0)]:
            assert server_tp(tqec_pos) == bgraph_tp(tqec_pos), f"divergence at {tqec_pos}"

    def test_pipe_endpoints_matches_server(self):
        from bgraph_endpoints import _pipe_endpoints as bgraph_pe
        from server import _pipe_endpoints as server_pe

        for pos in [[1, 0, 0], [0, 1, 0], [0, 0, 1], [4, 3, 0], [-2, 0, 0]]:
            assert server_pe(pos) == bgraph_pe(pos), f"divergence at {pos}"
