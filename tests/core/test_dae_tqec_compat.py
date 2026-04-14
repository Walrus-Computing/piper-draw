"""Test that piper-draw's DAE export is compatible with tqec's BlockGraph.from_dae_file()."""

import io
import tempfile
from pathlib import Path

import pytest

from tqec.computation.block_graph import BlockGraph
from tqec.computation.cube import YHalfCube, ZXCube
from tqec.computation.pipe import PipeKind
from tqec.utils.enums import Basis


# ---------------------------------------------------------------------------
# Helper: generate a DAE string matching piper-draw's export format
# ---------------------------------------------------------------------------


def _matrix_str(tx: float, ty: float, tz: float) -> str:
    return f"1 0 0 {tx} 0 1 0 {ty} 0 0 1 {tz} 0 0 0 1"


def _piper_draw_dae(blocks: list[tuple[str, tuple[float, float, float]]]) -> str:
    """Build a DAE XML string identical to what piper-draw's exportBlocksToDae produces.

    Args:
        blocks: list of (kind_lower, (tx, ty, tz)) tuples.
    """
    used_kinds = {kind for kind, _ in blocks}

    effects = ""
    for name, rgba in [
        ("X_red", "1 0.498 0.498 1"),
        ("Z_blue", "0.451 0.588 1 1"),
        ("Y_green", "0.388 0.776 0.463 1"),
        ("H_yellow", "1 1 0.396 1"),
    ]:
        effects += f"""
    <effect id="{name}_effect">
      <profile_COMMON>
        <technique sid="common">
          <lambert>
            <diffuse><color>{rgba}</color></diffuse>
            <transparent><color>{rgba}</color></transparent>
            <transparency><float>1</float></transparency>
          </lambert>
        </technique>
        <extra><technique profile="GOOGLEEARTH"><double_sided>1</double_sided></technique></extra>
      </profile_COMMON>
    </effect>"""

    materials = ""
    for name in ["X_red", "Z_blue", "Y_green", "H_yellow"]:
        materials += f"""
    <material id="{name}_material" name="{name}_material">
      <instance_effect url="#{name}_effect"/>
    </material>"""

    geometries = ""
    lib_nodes = ""
    for kind in used_kinds:
        gid = f"geom_{kind}"
        nid = f"lib_{kind}"
        geometries += f"""
    <geometry id="{gid}" name="{gid}">
      <mesh>
        <source id="{gid}_pos">
          <float_array id="{gid}_pos_arr" count="9">0 0 0 1 0 0 0 1 0</float_array>
          <technique_common>
            <accessor source="#{gid}_pos_arr" count="3" stride="3">
              <param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/>
            </accessor>
          </technique_common>
        </source>
        <source id="{gid}_norm">
          <float_array id="{gid}_norm_arr" count="9">0 0 1 0 0 1 0 0 1</float_array>
          <technique_common>
            <accessor source="#{gid}_norm_arr" count="3" stride="3">
              <param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/>
            </accessor>
          </technique_common>
        </source>
        <vertices id="{gid}_vtx">
          <input semantic="POSITION" source="#{gid}_pos"/>
        </vertices>
        <triangles count="1" material="MaterialSymbol">
          <input semantic="VERTEX" source="#{gid}_vtx" offset="0"/>
          <input semantic="NORMAL" source="#{gid}_norm" offset="1"/>
          <p>0 0 1 1 2 2</p>
        </triangles>
      </mesh>
    </geometry>"""
        lib_nodes += f"""
    <node id="{nid}" name="{kind}" type="NODE">
      <instance_geometry url="#{gid}">
        <bind_material>
          <technique_common>
            <instance_material symbol="MaterialSymbol" target="#X_red_material"/>
          </technique_common>
        </bind_material>
      </instance_geometry>
    </node>"""

    instances = ""
    for i, (kind, (tx, ty, tz)) in enumerate(blocks):
        nid = f"lib_{kind}"
        instances += f"""
        <node id="ID{i}" name="instance_{i}" type="NODE">
          <matrix>
{_matrix_str(tx, ty, tz)}
          </matrix>
          <instance_node url="#{nid}"/>
        </node>"""

    return f"""<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
  <asset>
    <contributor>
      <author>TQEC Community</author>
      <authoring_tool>https://github.com/tqec/tqec</authoring_tool>
    </contributor>
    <unit name="inch" meter="0.02539999969303608"/>
    <up_axis>Z_UP</up_axis>
  </asset>
  <library_effects>{effects}
  </library_effects>
  <library_materials>{materials}
  </library_materials>
  <library_geometries>{geometries}
  </library_geometries>
  <library_nodes>{lib_nodes}
  </library_nodes>
  <library_visual_scenes>
    <visual_scene id="ID_scene" name="SketchUp">
      <node id="ID_sketchup" name="SketchUp" type="NODE">{instances}
      </node>
    </visual_scene>
  </library_visual_scenes>
  <scene>
    <instance_visual_scene url="#ID_scene"/>
  </scene>
</COLLADA>"""


def _write_and_read(blocks: list[tuple[str, tuple[float, float, float]]]) -> BlockGraph:
    """Write DAE to a temp file and read it back with tqec."""
    xml = _piper_draw_dae(blocks)
    with tempfile.NamedTemporaryFile(suffix=".dae", mode="w", delete=False) as f:
        f.write(xml)
        f.flush()
        return BlockGraph.from_dae_file(f.name)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestDaeTqecCompat:
    def test_single_cube(self):
        """A single XZZ cube at origin should be read by tqec."""
        graph = _write_and_read([("xzz", (0, 0, 0))])
        assert len(graph.cubes) == 1
        cube = graph.cubes[0]
        assert str(cube.kind) == "XZZ"

    def test_cube_at_offset(self):
        """A cube at piper-draw position (3,0,0) = tqec integer (1,0,0)."""
        graph = _write_and_read([("xzz", (3, 0, 0))])
        assert len(graph.cubes) == 1
        cube = graph.cubes[0]
        assert cube.position.x == 1
        assert cube.position.y == 0
        assert cube.position.z == 0

    def test_two_cubes_with_pipe(self):
        """Two cubes connected by a pipe."""
        graph = _write_and_read([
            ("xzz", (0, 0, 0)),
            ("ozx", (1, 0, 0)),
            ("zxz", (3, 0, 0)),
        ])
        assert len(graph.cubes) == 2
        assert len(graph.pipes) == 1
        pipe = graph.pipes[0]
        assert str(pipe.kind) == "OZX"

    def test_hadamard_pipe(self):
        """Two cubes connected by a Hadamard pipe."""
        graph = _write_and_read([
            ("xzz", (0, 0, 0)),
            ("ozxh", (1, 0, 0)),
            ("xzz", (3, 0, 0)),
        ])
        assert len(graph.pipes) == 1
        pipe = graph.pipes[0]
        assert str(pipe.kind) == "OZXH"

    def test_all_cube_types(self):
        """All 6 ZXCube types should be parseable."""
        cube_types = ["xzz", "zxz", "zxx", "xxz", "zzx", "xzx"]
        blocks = [(kind, (i * 3, 0, 0)) for i, kind in enumerate(cube_types)]
        graph = _write_and_read(blocks)
        assert len(graph.cubes) == 6
        kinds = sorted(str(c.kind) for c in graph.cubes)
        assert kinds == sorted(k.upper() for k in cube_types)

    def test_y_pipe_direction(self):
        """Pipe along Y axis."""
        graph = _write_and_read([
            ("xzz", (0, 0, 0)),
            ("zox", (0, 1, 0)),
            ("xzz", (0, 3, 0)),
        ])
        assert len(graph.pipes) == 1
        pipe = graph.pipes[0]
        assert str(pipe.kind) == "ZOX"

    def test_z_pipe_direction(self):
        """Pipe along Z axis."""
        graph = _write_and_read([
            ("xzz", (0, 0, 0)),
            ("zxo", (0, 0, 1)),
            ("xzz", (0, 0, 3)),
        ])
        assert len(graph.pipes) == 1
        pipe = graph.pipes[0]
        assert str(pipe.kind) == "ZXO"

    def test_pipe_with_ports(self):
        """A pipe without cubes at endpoints should create Ports."""
        graph = _write_and_read([("ozx", (1, 0, 0))])
        # tqec auto-creates ports for pipe endpoints without cubes
        assert len(graph.pipes) == 1
        assert any(c.is_port for c in graph.cubes)
