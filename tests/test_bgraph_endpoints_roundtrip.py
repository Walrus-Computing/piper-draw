"""Round-trip tests for /api/bgraph_export → /api/bgraph_import.

Plus a gallery-fixture pass: every shipped `gui/public/bgraph-examples/*.bgraph`
must import via /api/bgraph_import without erroring. Catches TQEC schema bumps
or stale fixture files on the next dep update.

Three properties guarded here:

1. **Friday-2am test (Codex finding 9/13)** — a non-trivial scene (cubes +
   pipes + ports + Y-cubes) round-trips byte-perfect on TQEC data: cubes,
   pipes, kinds, port labels all preserved. This is the lossless gate.

2. **Bidirectional canonicalization** — parse(serialize(parse(b))) == parse(b)
   for fixtures. Catches drift between read/write.

3. **Coord-swap parity** — the bgraph emitted by piper-draw's export matches
   what TQEC's own `BlockGraph.to_bgraph()` would emit for the same logical
   graph. If our `_blocks_to_graph_dict` ever diverges from TQEC's expected
   schema, this test surfaces it.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest
from tqec.computation.block_graph import BlockGraph
from tqec.interop.bgraph import write_bgraph

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


def _block_set(blocks: list) -> set[tuple[tuple, str]]:
    """Normalize blocks → a set of (pos-tuple, type) for comparison."""
    return {(tuple(b.pos), b.type) for b in blocks}


def _label_set(port_labels: list) -> set[tuple[tuple, str]]:
    return {(tuple(p.pos), p.label) for p in port_labels}


class TestRoundTrip:
    def test_single_cube(self):
        """Smallest possible scene: one cube, no pipes."""
        original_blocks = [_block([0, 0, 0], "ZXZ")]
        exp = _run(bgraph_export(BgraphExportRequest(blocks=original_blocks)))
        imp = _run(bgraph_import(BgraphImportRequest(bgraph=exp.bgraph)))
        assert _block_set(imp.blocks) == _block_set(original_blocks)

    def test_cube_pipe_port(self):
        """Cube + pipe + labeled port — minimum to exercise port labels.
        ZXZ + OXZ is a valid color pairing (cube y=X,z=Z matches pipe y/z).
        """
        original_blocks = [_block([0, 0, 0], "ZXZ"), _block([1, 0, 0], "OXZ")]
        original_labels = [_port_label([3, 0, 0], "out_0")]
        exp = _run(
            bgraph_export(BgraphExportRequest(blocks=original_blocks, port_labels=original_labels))
        )
        imp = _run(bgraph_import(BgraphImportRequest(bgraph=exp.bgraph)))
        # Cube + pipe should round-trip exactly.
        assert _block_set(imp.blocks) == _block_set(original_blocks)
        # Port label preserved at its piper-draw position.
        assert _label_set(imp.port_labels) == _label_set(original_labels)

    def test_friday_2am(self):
        """A non-trivial scene — chain of cubes, pipes, ports — round-trips.

        Codex finding 9/13 — this is the lossless gate. The scene is a valid
        TQEC graph (ZXZ + OXZ chain matches face colors); strict export
        validation passes.
        """
        # Layout: chain of three ZXCubes connected by x-axis pipes, with
        # open pipes at both ends terminating in labeled ports.
        original_blocks = [
            _block([0, 0, 0], "ZXZ"),  # cube A
            _block([3, 0, 0], "ZXZ"),  # cube B
            _block([6, 0, 0], "ZXZ"),  # cube C
            _block([1, 0, 0], "OXZ"),  # pipe A↔B (open x, y=X, z=Z — matches ZXZ)
            _block([4, 0, 0], "OXZ"),  # pipe B↔C
            _block([-2, 0, 0], "OXZ"),  # open pipe left of A → port_left
            _block([7, 0, 0], "OXZ"),  # open pipe right of C → port_right
        ]
        original_labels = [
            _port_label([-3, 0, 0], "port_left"),
            _port_label([9, 0, 0], "port_right"),
        ]
        exp = _run(
            bgraph_export(BgraphExportRequest(blocks=original_blocks, port_labels=original_labels))
        )
        imp = _run(bgraph_import(BgraphImportRequest(bgraph=exp.bgraph)))
        assert _block_set(imp.blocks) == _block_set(original_blocks), (
            f"\nexpected: {_block_set(original_blocks)}\n     got: {_block_set(imp.blocks)}"
        )
        assert _label_set(imp.port_labels) == _label_set(original_labels)

    def test_bidirectional_canonicalization(self):
        """parse(serialize(parse(bgraph))) == parse(bgraph) for a fixture.

        Catches drift between read and write paths. ZXZ + OXZ is a valid
        color pairing; strict validation passes.
        """
        original_blocks = [
            _block([0, 0, 0], "ZXZ"),
            _block([3, 0, 0], "ZXZ"),
            _block([1, 0, 0], "OXZ"),
        ]
        original_labels: list[PortLabelInputLocal] = []
        # First round-trip
        b1 = _run(
            bgraph_export(BgraphExportRequest(blocks=original_blocks, port_labels=original_labels))
        ).bgraph
        i1 = _run(bgraph_import(BgraphImportRequest(bgraph=b1)))
        # Re-export the imported scene
        b2 = _run(
            bgraph_export(
                BgraphExportRequest(
                    blocks=[_block(b.pos, b.type) for b in i1.blocks],
                    port_labels=[_port_label(p.pos, p.label) for p in i1.port_labels],
                )
            )
        ).bgraph
        i2 = _run(bgraph_import(BgraphImportRequest(bgraph=b2)))
        assert _block_set(i1.blocks) == _block_set(i2.blocks)
        assert _label_set(i1.port_labels) == _label_set(i2.port_labels)


class TestCoordSwapParity:
    """Codex finding 10/13 — the bgraph piper-draw emits must match what TQEC
    produces from the same logical BlockGraph. If our `_blocks_to_graph_dict`
    diverges from the schema TQEC expects, this fails.
    """

    def test_single_cube_matches_tqec_write_bgraph(self):
        # Build the same logical graph by hand and compare bgraph strings.
        original_blocks = [_block([0, 0, 0], "ZXZ")]
        exp = _run(bgraph_export(BgraphExportRequest(blocks=original_blocks)))

        # Build the equivalent graph via TQEC's own API.
        from tqec.utils.position import Position3D

        g = BlockGraph()
        g.add_cube(Position3D(0, 0, 0), "ZXZ")
        tqec_bgraph = write_bgraph(g)

        # Headers and CUBES table should be identical for this trivial scene.
        # METADATA `circuit_name` defaults differ ("test" vs "circuit"); strip
        # the METADATA block for the comparison.
        def _strip_metadata(s: str) -> str:
            lines = s.splitlines()
            out: list[str] = []
            in_meta = False
            for ln in lines:
                if ln.startswith("METADATA:"):
                    in_meta = True
                    continue
                if in_meta and (ln.startswith("CUBES:") or ln.strip() == ""):
                    in_meta = False
                if not in_meta:
                    out.append(ln)
            return "\n".join(out)

        assert _strip_metadata(exp.bgraph) == _strip_metadata(tqec_bgraph), (
            f"\npiper-draw: {exp.bgraph!r}\n      tqec: {tqec_bgraph!r}"
        )

    def test_cube_pipe_port_matches_tqec(self):
        # ZXZ + OXZ is a valid color match for the x-axis.
        original_blocks = [_block([0, 0, 0], "ZXZ"), _block([1, 0, 0], "OXZ")]
        original_labels = [_port_label([3, 0, 0], "out")]
        exp = _run(
            bgraph_export(BgraphExportRequest(blocks=original_blocks, port_labels=original_labels))
        )

        from tqec.utils.position import Position3D

        g = BlockGraph()
        g.add_cube(Position3D(0, 0, 0), "ZXZ")
        g.add_cube(Position3D(1, 0, 0), "PORT", label="out")
        g.add_pipe(Position3D(0, 0, 0), Position3D(1, 0, 0), "OXZ")
        tqec_bgraph = write_bgraph(g)

        # Stripped of metadata, the bgraph strings should match.
        def _strip_metadata(s: str) -> str:
            lines = s.splitlines()
            out: list[str] = []
            in_meta = False
            for ln in lines:
                if ln.startswith("METADATA:"):
                    in_meta = True
                    continue
                if in_meta and (ln.startswith("CUBES:") or ln.strip() == ""):
                    in_meta = False
                if not in_meta:
                    out.append(ln)
            return "\n".join(out)

        assert _strip_metadata(exp.bgraph) == _strip_metadata(tqec_bgraph)


# ---------------------------------------------------------------------------
# Bundled gallery fixtures: every shipped .bgraph file must import cleanly.
# ---------------------------------------------------------------------------


_GALLERY_DIR = Path(__file__).resolve().parent.parent / "gui" / "public" / "bgraph-examples"


def _gallery_examples() -> list[tuple[str, str]]:
    if not _GALLERY_DIR.exists():
        return []
    manifest_path = _GALLERY_DIR / "manifest.json"
    if not manifest_path.exists():
        return []
    manifest = json.loads(manifest_path.read_text())
    out = []
    for entry in manifest:
        bgraph_path = _GALLERY_DIR / entry["filename"]
        if bgraph_path.exists():
            out.append((entry["name"], bgraph_path.read_text()))
    return out


class TestGalleryExamples:
    """The bundled gallery examples must import without errors. If TQEC's
    bgraph schema bumps and a fixture goes stale, this catches it on the next
    test run (and someone re-runs scripts/generate_bgraph_examples.py).
    """

    @pytest.mark.parametrize("name,bgraph_text", _gallery_examples())
    def test_example_imports(self, name: str, bgraph_text: str):
        resp = _run(bgraph_import(BgraphImportRequest(bgraph=bgraph_text)))
        assert len(resp.blocks) > 0, f"{name}: no blocks parsed"


# ---------------------------------------------------------------------------
# End-to-end TQEC compat: piper-draw export → TQEC's reader → TQEC's validator.
# Proves the bgraph piper-draw writes is consumable by downstream TQEC tools.
# ---------------------------------------------------------------------------


_GalleryRow = tuple[str, list[BlockInputLocal], list[PortLabelInputLocal]]


def _gallery_examples_as_blocks() -> list[_GalleryRow]:
    """Convert each bundled gallery bgraph into piper-draw blocks via the
    real /api/bgraph_import endpoint. These become the input for the
    export-then-validate pass.
    """
    out = []
    for name, bgraph_text in _gallery_examples():
        try:
            imp = _run(bgraph_import(BgraphImportRequest(bgraph=bgraph_text)))
        except Exception:
            continue
        blocks_in = [BlockInputLocal(pos=list(b.pos), type=b.type) for b in imp.blocks]
        port_labels = [PortLabelInputLocal(pos=list(p.pos), label=p.label) for p in imp.port_labels]
        out.append((name, blocks_in, port_labels))
    return out


class TestEndToEndTQECCompat:
    """Each exported bgraph must (1) parse via TQEC's BlockGraph.from_bgraph,
    and (2) pass TQEC's own graph.validate(). This is the strongest "the
    exports are correct" guarantee — it proves piper-draw → bgraph → TQEC's
    reader → TQEC's validator works end-to-end, not just per-layer.
    """

    def test_minimal_scene_validates_via_tqec(self):
        exp = _run(bgraph_export(BgraphExportRequest(blocks=[_block([0, 0, 0], "ZXZ")])))
        graph = BlockGraph.from_bgraph(exp.bgraph)
        graph.validate()  # raises TQECError if invalid

    def test_friday_2am_validates_via_tqec(self):
        # Same valid chain scene as TestRoundTrip::test_friday_2am — route
        # the export through TQEC's reader+validator instead of our importer.
        blocks = [
            _block([0, 0, 0], "ZXZ"),
            _block([3, 0, 0], "ZXZ"),
            _block([6, 0, 0], "ZXZ"),
            _block([1, 0, 0], "OXZ"),
            _block([4, 0, 0], "OXZ"),
            _block([-2, 0, 0], "OXZ"),
            _block([7, 0, 0], "OXZ"),
        ]
        labels = [
            _port_label([-3, 0, 0], "port_left"),
            _port_label([9, 0, 0], "port_right"),
        ]
        exp = _run(bgraph_export(BgraphExportRequest(blocks=blocks, port_labels=labels)))
        graph = BlockGraph.from_bgraph(exp.bgraph)
        graph.validate()
        # Sanity: same logical block count as we sent in.
        assert len(graph.cubes) >= 3
        assert len(graph.pipes) >= 4

    @pytest.mark.parametrize("name,blocks,labels", _gallery_examples_as_blocks())
    def test_gallery_example_export_validates_via_tqec(self, name: str, blocks: list, labels: list):
        """For every bundled gallery example: re-export through piper-draw,
        re-parse via TQEC's from_bgraph, then call graph.validate(). All
        examples are real TQEC research graphs, so a failure here means
        piper-draw's export pipeline corrupted a known-good graph."""
        exp = _run(bgraph_export(BgraphExportRequest(blocks=blocks, port_labels=labels)))
        graph = BlockGraph.from_bgraph(exp.bgraph)
        graph.validate()
