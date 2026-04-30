import type { Block } from "../types";

/**
 * Okabe-Ito 8-color colorblind-safe palette. Group outlines are coloured by
 * `palette[hash(groupId) % 8]`. With >8 groups in a scene, two groups share a
 * hue (and dash pattern) — accepted v1 trade-off until the future sidebar UI
 * lands.
 */
export const OKABE_ITO_PALETTE: ReadonlyArray<string> = [
  "#000000", // black
  "#E69F00", // orange
  "#56B4E9", // sky blue
  "#009E73", // bluish green
  "#F0E442", // yellow
  "#0072B2", // blue
  "#D55E00", // vermilion
  "#CC79A7", // reddish purple
];

/** Eight distinct dash patterns to disambiguate groups under colour collision. */
export const GROUP_DASH_PATTERNS: ReadonlyArray<{ dashSize: number; gapSize: number }> = [
  { dashSize: 0.20, gapSize: 0.08 },
  { dashSize: 0.10, gapSize: 0.10 },
  { dashSize: 0.30, gapSize: 0.10 },
  { dashSize: 0.06, gapSize: 0.06 },
  { dashSize: 0.16, gapSize: 0.04 },
  { dashSize: 0.24, gapSize: 0.16 },
  { dashSize: 0.10, gapSize: 0.20 },
  { dashSize: 0.40, gapSize: 0.20 },
];

function hashGroupId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function paletteIndexFor(groupId: string): number {
  return hashGroupId(groupId) % OKABE_ITO_PALETTE.length;
}

export function groupColor(groupId: string): string {
  return OKABE_ITO_PALETTE[paletteIndexFor(groupId)];
}

/** O(1). The block's `groupId`, or `undefined` if ungrouped or absent. */
export function groupOf(blocks: Map<string, Block>, posKeyStr: string): string | undefined {
  return blocks.get(posKeyStr)?.groupId;
}

/** O(scene). All posKeys whose block has the given groupId. */
export function groupMembers(blocks: Map<string, Block>, gid: string): string[] {
  const out: string[] = [];
  for (const [k, b] of blocks) if (b.groupId === gid) out.push(k);
  return out;
}

/** O(scene). The set of distinct groupIds present in the scene. */
export function allGroupIds(blocks: Map<string, Block>): Set<string> {
  const s = new Set<string>();
  for (const b of blocks.values()) if (b.groupId) s.add(b.groupId);
  return s;
}

/** O(scene). Map of just the blocks belonging to the given groupId. */
export function filterByGroup(
  blocks: Map<string, Block>,
  gid: string,
): Map<string, Block> {
  const out = new Map<string, Block>();
  for (const [k, b] of blocks) if (b.groupId === gid) out.set(k, b);
  return out;
}

/**
 * Return a Block with `groupId` removed (if present). Other fields are
 * preserved via spread, so future Block metadata rides through untouched.
 * Used by ungroup paths to clear membership without losing other fields.
 */
export function withoutGroupId(b: Block): Block {
  if (b.groupId === undefined) return b;
  const stripped = { ...b };
  delete (stripped as { groupId?: string }).groupId;
  return stripped;
}

/**
 * Generate a fresh 8-character group ID from the lowercase alphanumeric
 * alphabet. 36^8 ≈ 2.8 trillion possibilities — non-cryptographic but more
 * than sufficient for collision avoidance within a single session.
 */
const GROUP_ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
export function newGroupId(): string {
  let s = "";
  for (let i = 0; i < 8; i++) {
    s += GROUP_ID_ALPHABET[Math.floor(Math.random() * GROUP_ID_ALPHABET.length)];
  }
  return s;
}

// ---------------------------------------------------------------------------
// Selection classification — drives the `g` keystroke truth table.
// ---------------------------------------------------------------------------

export type SelectionGroupClass =
  | { kind: "empty" }
  | { kind: "single-ungrouped" }
  | { kind: "single-grouped"; groupId: string }
  | { kind: "all-ungrouped" }
  | { kind: "all-same-group"; groupId: string }
  | { kind: "mixed-grouped-ungrouped" }
  | { kind: "multi-group"; groupIds: string[] };

export function selectionGroupClassification(
  blocks: Map<string, Block>,
  selectedKeys: ReadonlySet<string>,
): SelectionGroupClass {
  const size = selectedKeys.size;
  if (size === 0) return { kind: "empty" };
  if (size === 1) {
    const key = selectedKeys.values().next().value as string;
    const gid = blocks.get(key)?.groupId;
    return gid === undefined
      ? { kind: "single-ungrouped" }
      : { kind: "single-grouped", groupId: gid };
  }
  let hasUngrouped = false;
  const distinctGids = new Set<string>();
  for (const key of selectedKeys) {
    const gid = blocks.get(key)?.groupId;
    if (gid === undefined) {
      hasUngrouped = true;
    } else {
      distinctGids.add(gid);
    }
  }
  if (distinctGids.size === 0) return { kind: "all-ungrouped" };
  if (hasUngrouped) return { kind: "mixed-grouped-ungrouped" };
  if (distinctGids.size === 1) {
    return { kind: "all-same-group", groupId: distinctGids.values().next().value as string };
  }
  return { kind: "multi-group", groupIds: [...distinctGids] };
}

/**
 * Heuristic: does this Block kind participate in TQEC verification? Used by
 * the verify-scoped-to-group flow to detect "no TQEC-eligible members" groups
 * (e.g. all-slabs) before POSTing to /api/validate, so we can show a clear
 * toast instead of a misleading "verify passed" on an empty graph.
 *
 * Currently: cubes (XZZ etc.), Y-cubes, and pipes are TQEC-eligible. Slabs
 * are dropped before TQEC validate (see daeExport.ts:74-79 precedent). When
 * future block kinds land, extend this guard.
 */
export function isTqecEligibleBlock(b: Block): boolean {
  // Slabs are decorative free-build elements — not part of TQEC validation.
  // Currently the only non-TQEC block kind in piper-draw.
  return (b.type as string) !== "slab";
}
