import type { Block, BlockType, PortMeta } from "../types";
import { CUBE_TYPES, PIPE_TYPES } from "../types";
import { useBlockStore } from "../stores/blockStore";

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

export function applySnapshot(snapshot: SceneSnapshotV1, mode: ApplyMode = "hydrate"): void {
  const store = useBlockStore.getState();
  const blocks = new Map<string, Block>(snapshot.blocks);
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
