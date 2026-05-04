import type { Block, BlockType, PortMeta } from "../types";
import { CUBE_TYPES, PIPE_TYPES } from "../types";
import { useBlockStore } from "../stores/blockStore";
import { migrateFaceKeysToAxisKeys } from "./corrSurfaceGeom";

/**
 * Block fields the sanitizer cares about beyond the canonical `Block` shape:
 * the legacy `faceCorrSurface` field (per-face-keyed) which we accept on
 * load and translate into `corrSurfaceMarks` (per-axis-keyed). New scenes
 * never write `faceCorrSurface`; this exists solely for backward compat
 * with localStorage / URL-share payloads from the prior schema.
 */
type BlockWithLegacyFields = Block & {
  faceCorrSurface?: Record<string, "X" | "Z">;
};

export const SCENE_SCHEMA_VERSION = 1;

export interface SceneSnapshotV1 {
  v: 1;
  blocks: Array<[string, Block]>;
  portMeta: Array<[string, PortMeta]>;
  portPositions: string[];
}

// Validator constants. Loose enough to accept any scene the GUI itself can
// author, tight enough that URL-hash payloads can't smuggle non-finite
// coords, oversized labels, or unknown block types into the store.
const COORD_BOUND = 1_000_000;
const MAX_LABEL_LEN = 64;
const PORT_POSITION_RE = /^-?\d+,-?\d+,-?\d+$/;
// Printable ASCII + space, no control chars. Matches the post-trim labels
// setPortLabel actually accepts; rejects newlines/NUL that the validator
// would otherwise let through.
const LABEL_RE = /^[\x20-\x7E]+$/;
// Group IDs are 8-char lowercase alphanumerics (newGroupId in groupSelectors).
// Validate to reject hostile URL-share payloads with crafted groupId values.
const GROUP_ID_RE = /^[0-9a-z]{8}$/;
const VALID_BLOCK_TYPES: ReadonlySet<BlockType> = new Set<BlockType>([
  ...CUBE_TYPES,
  ...PIPE_TYPES,
  "Y",
]);

function isFiniteCoord(n: unknown): n is number {
  return (
    typeof n === "number" &&
    Number.isFinite(n) &&
    Math.abs(n) <= COORD_BOUND
  );
}

export function captureSnapshot(): SceneSnapshotV1 {
  const s = useBlockStore.getState();
  return {
    v: 1,
    blocks: Array.from(s.blocks.entries()),
    portMeta: Array.from(s.portMeta.entries()),
    portPositions: Array.from(s.portPositions),
  };
}

export function snapshotIsEmpty(snapshot: SceneSnapshotV1): boolean {
  return snapshot.blocks.length === 0;
}

export function isSceneSnapshotV1(value: unknown): value is SceneSnapshotV1 {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<SceneSnapshotV1>;
  if (v.v !== 1) return false;
  if (!Array.isArray(v.blocks) || !Array.isArray(v.portMeta) || !Array.isArray(v.portPositions)) {
    return false;
  }
  for (const entry of v.blocks) {
    if (!Array.isArray(entry) || entry.length !== 2) return false;
    if (typeof entry[0] !== "string") return false;
    const block = entry[1] as Partial<Block> | undefined;
    if (!block || typeof block !== "object") return false;
    if (typeof block.type !== "string" || !VALID_BLOCK_TYPES.has(block.type as BlockType)) {
      return false;
    }
    if (!block.pos || typeof block.pos !== "object") return false;
    const { x, y, z } = block.pos;
    if (!isFiniteCoord(x) || !isFiniteCoord(y) || !isFiniteCoord(z)) return false;
    if (block.groupId !== undefined) {
      if (typeof block.groupId !== "string") return false;
      if (!GROUP_ID_RE.test(block.groupId)) return false;
    }
  }
  const seenLabels = new Set<string>();
  for (const entry of v.portMeta) {
    if (!Array.isArray(entry) || entry.length !== 2) return false;
    if (typeof entry[0] !== "string") return false;
    const meta = entry[1] as Partial<PortMeta> | undefined;
    if (!meta || typeof meta.label !== "string") return false;
    if (meta.label.length === 0 || meta.label.length > MAX_LABEL_LEN) return false;
    if (!LABEL_RE.test(meta.label)) return false;
    // TQEC requires unique port labels; setPortLabel enforces this in the GUI,
    // so a duplicate here means the payload was hand-crafted and would race the
    // server-side rename in convert_blocks (see /api/flows error path).
    if (seenLabels.has(meta.label)) return false;
    seenLabels.add(meta.label);
    if (meta.io !== "in" && meta.io !== "out") return false;
    if (meta.rank !== undefined) {
      if (
        typeof meta.rank !== "number" ||
        !Number.isFinite(meta.rank) ||
        !Number.isInteger(meta.rank)
      ) {
        return false;
      }
    }
  }
  for (const p of v.portPositions) {
    if (typeof p !== "string") return false;
    if (!PORT_POSITION_RE.test(p)) return false;
  }
  return true;
}

export type ApplyMode = "load" | "hydrate";

/**
 * Sanitize a block's optional annotations on snapshot load.
 *
 * Two responsibilities:
 *   1. **Validation:** drop malformed payloads (non-object, wrong value types,
 *      malformed entries) silently rather than throwing — older or tampered
 *      snapshots should still load with the geometry intact.
 *   2. **Legacy migration:** translate any `faceCorrSurface` field (the
 *      per-face-keyed schema from before the per-axis migration) into the
 *      current `corrSurfaceMarks` field. The translator dedupes by axis
 *      (face 2 + face 3 → axis 1, last-write-wins) and preserves H/Y strip
 *      suffixes. After this runs, `faceCorrSurface` is always absent.
 */
function sanitizeBlock(block: Block): Block {
  // Treat legacy fields as a wider Block shape for the duration of this fn.
  const input = block as BlockWithLegacyFields;
  let out: BlockWithLegacyFields = input;

  // --- faceColors ---
  if (input.faceColors !== undefined) {
    if (typeof input.faceColors !== "object" || input.faceColors === null || Array.isArray(input.faceColors)) {
      out = { ...out };
      delete out.faceColors;
    } else {
      const cleaned: Record<string, string> = {};
      for (const [k, v] of Object.entries(input.faceColors)) {
        if (typeof v === "string") cleaned[k] = v;
      }
      if (Object.keys(cleaned).length === 0) {
        out = { ...out };
        delete out.faceColors;
      } else if (cleaned !== input.faceColors) {
        out = { ...out, faceColors: cleaned };
      }
    }
  }

  // --- legacy faceCorrSurface → corrSurfaceMarks (translator) ---
  if (input.faceCorrSurface !== undefined) {
    if (typeof input.faceCorrSurface === "object" && input.faceCorrSurface !== null && !Array.isArray(input.faceCorrSurface)) {
      // Filter to just the X/Z values, then translate face-keys → axis-keys.
      const cleaned: Record<string, "X" | "Z"> = {};
      for (const [k, v] of Object.entries(input.faceCorrSurface)) {
        if (v === "X" || v === "Z") cleaned[k] = v;
      }
      const migrated = migrateFaceKeysToAxisKeys(cleaned);
      if (migrated) {
        // Merge: legacy migrated marks + any existing axis-keyed marks.
        // Legacy wins on conflict (it's the data the user authored before
        // migration; existing axis-keyed entries during a partial reload
        // are unexpected but we preserve them defensively).
        out = { ...out, corrSurfaceMarks: { ...(out.corrSurfaceMarks ?? {}), ...migrated } };
      }
    }
    // Always strip the legacy field — it's never valid in current schema.
    out = { ...out };
    delete out.faceCorrSurface;
  }

  // --- corrSurfaceMarks (canonical) ---
  if (out.corrSurfaceMarks !== undefined) {
    if (typeof out.corrSurfaceMarks !== "object" || out.corrSurfaceMarks === null || Array.isArray(out.corrSurfaceMarks)) {
      out = { ...out };
      delete out.corrSurfaceMarks;
    } else {
      // Strict: drop entries with non-X/Z values. Key shape is validated by
      // parseSliceKey at render time, but we drop obviously malformed values
      // here so the store never holds garbage.
      const cleaned: Record<string, "X" | "Z"> = {};
      for (const [k, v] of Object.entries(out.corrSurfaceMarks)) {
        if (v === "X" || v === "Z") cleaned[k] = v;
      }
      if (Object.keys(cleaned).length === 0) {
        out = { ...out };
        delete out.corrSurfaceMarks;
      } else if (cleaned !== out.corrSurfaceMarks) {
        out = { ...out, corrSurfaceMarks: cleaned };
      }
    }
  }

  return out as Block;
}

export function applySnapshot(snapshot: SceneSnapshotV1, mode: ApplyMode = "hydrate"): void {
  const store = useBlockStore.getState();
  // Sanitize each block (drops malformed faceColors/faceCorrSurface payloads,
  // translates legacy schemas if needed) before installing.
  const blocks = new Map<string, Block>();
  for (const [key, block] of snapshot.blocks) {
    blocks.set(key, sanitizeBlock(block));
  }
  const portMeta = new Map(snapshot.portMeta);
  const portPositions = new Set(snapshot.portPositions);
  if (mode === "load") {
    // Load atomically so undo restores blocks + ports together (the load
    // undo command captures both). Bypassing this and setStateing ports
    // separately would leave undo asymmetric.
    store.loadBlocks(blocks, { portMeta, portPositions });
  } else {
    store.hydrateBlocks(blocks);
    useBlockStore.setState({ portMeta, portPositions });
  }
  useBlockStore.getState().ensurePortLabels();
}
