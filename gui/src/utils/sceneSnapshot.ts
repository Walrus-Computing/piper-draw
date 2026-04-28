import type { Block, PortMeta } from "../types";
import { useBlockStore } from "../stores/blockStore";

export const SCENE_SCHEMA_VERSION = 1;

export interface SceneSnapshotV1 {
  v: 1;
  blocks: Array<[string, Block]>;
  portMeta: Array<[string, PortMeta]>;
  portPositions: string[];
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
    if (typeof block.type !== "string") return false;
    if (!block.pos || typeof block.pos !== "object") return false;
    const { x, y, z } = block.pos;
    if (typeof x !== "number" || typeof y !== "number" || typeof z !== "number") return false;
  }
  for (const entry of v.portMeta) {
    if (!Array.isArray(entry) || entry.length !== 2) return false;
    if (typeof entry[0] !== "string") return false;
    const meta = entry[1] as Partial<PortMeta> | undefined;
    if (!meta || typeof meta.label !== "string") return false;
    if (meta.io !== "in" && meta.io !== "out") return false;
  }
  for (const p of v.portPositions) {
    if (typeof p !== "string") return false;
  }
  return true;
}

export type ApplyMode = "load" | "hydrate";

export function applySnapshot(snapshot: SceneSnapshotV1, mode: ApplyMode = "hydrate"): void {
  const store = useBlockStore.getState();
  const blocks = new Map<string, Block>(snapshot.blocks);
  if (mode === "load") store.loadBlocks(blocks);
  else store.hydrateBlocks(blocks);
  useBlockStore.setState({
    portMeta: new Map(snapshot.portMeta),
    portPositions: new Set(snapshot.portPositions),
  });
  useBlockStore.getState().ensurePortLabels();
}
