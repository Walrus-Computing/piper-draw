// ---------------------------------------------------------------------------
// Convert a /api/bgraph_import response into a piper-draw Block Map + a
// normalization count. Applies the sandwich-cube canonicalization rule via
// canonicaliseImportedCubes so DAE and bgraph imports share one rule
// (CLAUDE.md "Canonicalisation assumption").
//
// The backend returns blocks in piper-draw coords already (eng review E4
// chose 100% server-side coord swap); this helper is pure block-shape glue
// plus the optional normalization pass.
// ---------------------------------------------------------------------------

import type { Block, BlockType, Position3D } from "../types";
import type { BgraphImportResponse, BgraphPortLabelOutput } from "../types/bgraph";
import { posKey } from "../types";
import { canonicaliseImportedCubes } from "./daeImport";

export interface BgraphImportConverted {
  blocks: Map<string, Block>;
  portLabels: { pos: Position3D; label: string }[];
  /** Count of cubes whose type changed via the sandwich-cube canonicalization
   *  rule. Used by the toast wording ("Normalized N cube types"). */
  normalizedCount: number;
}

export function bgraphResponseToBlocks(resp: BgraphImportResponse): BgraphImportConverted {
  const blocks = new Map<string, Block>();
  for (const b of resp.blocks) {
    const pos = { x: b.pos[0], y: b.pos[1], z: b.pos[2] };
    blocks.set(posKey(pos), { pos, type: b.type as BlockType });
  }
  const normalizedCount = canonicaliseImportedCubes(blocks);
  const portLabels = resp.port_labels.map((p: BgraphPortLabelOutput) => ({
    pos: { x: p.pos[0], y: p.pos[1], z: p.pos[2] },
    label: p.label,
  }));
  return { blocks, portLabels, normalizedCount };
}
