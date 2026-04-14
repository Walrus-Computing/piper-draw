import type { Block, BlockType } from "../types";
import { isPipeType } from "../types";

// ---------------------------------------------------------------------------
// Constants matching tqec's Collada output
// ---------------------------------------------------------------------------

const COLLADA_NS = "http://www.collada.org/2005/11/COLLADASchema";
const ASSET_UNIT_METER = "0.02539999969303608";

/**
 * Check whether a Y block at `pos` has a pipe directly above it (at pos.z + 1).
 */
function yBlockHasPipeAbove(pos: { x: number; y: number; z: number }, blocks: Map<string, Block>): boolean {
  const aboveKey = `${pos.x},${pos.y},${pos.z + 1}`;
  const above = blocks.get(aboveKey);
  return above != null && isPipeType(above.type);
}

// ---------------------------------------------------------------------------
// XML generation helpers
// ---------------------------------------------------------------------------

function matrixString(tx: number, ty: number, tz: number): string {
  return `1 0 0 ${tx} 0 1 0 ${ty} 0 0 1 ${tz} 0 0 0 1`;
}

/** Stub geometry: a single degenerate triangle. tqec ignores geometry on import. */
function stubGeometryXml(id: string): string {
  return `
    <geometry id="${id}" name="${id}">
      <mesh>
        <source id="${id}_pos">
          <float_array id="${id}_pos_arr" count="9">0 0 0 1 0 0 0 1 0</float_array>
          <technique_common>
            <accessor source="#${id}_pos_arr" count="3" stride="3">
              <param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/>
            </accessor>
          </technique_common>
        </source>
        <source id="${id}_norm">
          <float_array id="${id}_norm_arr" count="9">0 0 1 0 0 1 0 0 1</float_array>
          <technique_common>
            <accessor source="#${id}_norm_arr" count="3" stride="3">
              <param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/>
            </accessor>
          </technique_common>
        </source>
        <vertices id="${id}_vtx">
          <input semantic="POSITION" source="#${id}_pos"/>
        </vertices>
        <triangles count="1" material="MaterialSymbol">
          <input semantic="VERTEX" source="#${id}_vtx" offset="0"/>
          <input semantic="NORMAL" source="#${id}_norm" offset="1"/>
          <p>0 0 1 1 2 2</p>
        </triangles>
      </mesh>
    </geometry>`;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * Export the block map to a tqec-compatible Collada DAE XML string.
 *
 * Coordinate mapping: piper-draw positions map 1:1 to DAE positions
 * (both use the same mod-3 grid where scale factor = 1 + pipe_length = 3).
 */
export function exportBlocksToDae(blocks: Map<string, Block>): string {
  // Collect unique block kinds
  const usedKinds = new Set<string>();
  for (const block of blocks.values()) {
    usedKinds.add(block.type);
  }

  // Build materials XML — always include all 4 to keep it simple
  const materials = [
    { name: "X_red", r: 1.0, g: 0.498, b: 0.498, a: 1.0 },
    { name: "Z_blue", r: 0.451, g: 0.588, b: 1.0, a: 1.0 },
    { name: "Y_green", r: 0.388, g: 0.776, b: 0.463, a: 1.0 },
    { name: "H_yellow", r: 1.0, g: 1.0, b: 0.396, a: 1.0 },
  ];

  const effectsXml = materials
    .map(
      (m) => `
    <effect id="${m.name}_effect">
      <profile_COMMON>
        <technique sid="common">
          <lambert>
            <diffuse><color>${m.r} ${m.g} ${m.b} ${m.a}</color></diffuse>
            <transparent><color>${m.r} ${m.g} ${m.b} ${m.a}</color></transparent>
            <transparency><float>${m.a}</float></transparency>
          </lambert>
        </technique>
        <extra><technique profile="GOOGLEEARTH"><double_sided>1</double_sided></technique></extra>
      </profile_COMMON>
    </effect>`,
    )
    .join("");

  const materialsXml = materials
    .map(
      (m) => `
    <material id="${m.name}_material" name="${m.name}_material">
      <instance_effect url="#${m.name}_effect"/>
    </material>`,
    )
    .join("");

  // Build library geometries & library nodes for each used block kind
  const geometriesXml: string[] = [];
  const libraryNodesXml: string[] = [];

  for (const kind of usedKinds) {
    const kindLower = kind.toLowerCase();
    const geomId = `geom_${kindLower}`;
    const nodeId = `lib_${kindLower}`;

    geometriesXml.push(stubGeometryXml(geomId));

    libraryNodesXml.push(`
    <node id="${nodeId}" name="${kindLower}" type="NODE">
      <instance_geometry url="#${geomId}">
        <bind_material>
          <technique_common>
            <instance_material symbol="MaterialSymbol" target="#X_red_material"/>
          </technique_common>
        </bind_material>
      </instance_geometry>
    </node>`);
  }

  // Build instance nodes inside the SketchUp parent
  const instanceNodesXml: string[] = [];
  let instanceIdx = 0;

  for (const block of blocks.values()) {
    const kindLower = block.type.toLowerCase();
    const nodeId = `lib_${kindLower}`;

    let tx = block.pos.x;
    let ty = block.pos.y;
    let tz = block.pos.z;

    // Y half-cube offset: shift +0.5 in Z when there's a pipe above
    if (block.type === "Y" && yBlockHasPipeAbove(block.pos, blocks)) {
      tz += 0.5;
    }

    // For pipes, the DAE matrix uses identity scale (pipe_length=2.0 → scale=1.0)
    const mat = matrixString(tx, ty, tz);

    instanceNodesXml.push(`
        <node id="ID${instanceIdx}" name="instance_${instanceIdx}" type="NODE">
          <matrix>
${mat}
          </matrix>
          <instance_node url="#${nodeId}"/>
        </node>`);
    instanceIdx++;
  }

  return `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="${COLLADA_NS}" version="1.4.1">
  <asset>
    <contributor>
      <author>TQEC Community</author>
      <authoring_tool>https://github.com/tqec/tqec</authoring_tool>
    </contributor>
    <unit name="inch" meter="${ASSET_UNIT_METER}"/>
    <up_axis>Z_UP</up_axis>
  </asset>
  <library_effects>${effectsXml}
  </library_effects>
  <library_materials>${materialsXml}
  </library_materials>
  <library_geometries>${geometriesXml.join("")}
  </library_geometries>
  <library_nodes>${libraryNodesXml.join("")}
  </library_nodes>
  <library_visual_scenes>
    <visual_scene id="ID_scene" name="SketchUp">
      <node id="ID_sketchup" name="SketchUp" type="NODE">${instanceNodesXml.join("")}
      </node>
    </visual_scene>
  </library_visual_scenes>
  <scene>
    <instance_visual_scene url="#ID_scene"/>
  </scene>
</COLLADA>`;
}

/**
 * Export blocks to a DAE file, prompting the user for save location and name.
 * Uses the File System Access API (showSaveFilePicker) when available,
 * with a fallback to a traditional download for unsupported browsers.
 */
export async function downloadDae(blocks: Map<string, Block>, filename = "diagram.dae"): Promise<void> {
  const xml = exportBlocksToDae(blocks);
  const blob = new Blob([xml], { type: "model/vnd.collada+xml" });

  if (typeof window.showSaveFilePicker === "function") {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [
          {
            description: "Collada DAE file",
            accept: { "model/vnd.collada+xml": [".dae"] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err: unknown) {
      // User cancelled the dialog
      if (err instanceof DOMException && err.name === "AbortError") return;
      throw err;
    }
  }

  // Fallback for browsers without File System Access API
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
