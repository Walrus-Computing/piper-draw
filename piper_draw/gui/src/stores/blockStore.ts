import { create } from "zustand";
import type { Position3D, Block, BlockType, PipeVariant, SpatialIndex, FaceMask } from "../types";
import {
  posKey,
  hasBlockOverlap,
  isValidPos,
  resolvePipeType,
  buildSpatialIndex,
  addToSpatialIndex,
  removeFromSpatialIndex,
  recomputeAffectedHiddenFaces,
} from "../types";

export type Mode = "place" | "delete";

const MAX_HISTORY = 100;

/** Canonical X-open PipeType for each variant, used as cubeType fallback. */
const PIPE_VARIANT_CANONICAL: Record<PipeVariant, BlockType> = {
  ZX: "OZX", XZ: "OXZ", ZXH: "OZXH", XZH: "OXZH",
};

// ---------------------------------------------------------------------------
// Command-based undo — stores the operation, not a full state snapshot.
// Add/remove commands are O(1) memory; clear saves the full map (rare).
// ---------------------------------------------------------------------------

type UndoCommand =
  | { kind: "add"; key: string; block: Block }
  | { kind: "remove"; key: string; block: Block }
  | { kind: "clear"; savedBlocks: Map<string, Block>; savedHiddenFaces: Map<string, FaceMask> };

interface BlockStore {
  blocks: Map<string, Block>;
  spatialIndex: SpatialIndex;
  hiddenFaces: Map<string, FaceMask>;
  history: UndoCommand[];
  future: UndoCommand[];
  mode: Mode;
  cubeType: BlockType;
  pipeVariant: PipeVariant | null;
  hoveredGridPos: Position3D | null;
  hoveredBlockType: BlockType | null;
  hoveredInvalid: boolean;

  setMode: (mode: Mode) => void;
  setCubeType: (cubeType: BlockType) => void;
  setPipeVariant: (variant: PipeVariant) => void;
  setHoveredGridPos: (pos: Position3D | null, blockType?: BlockType, invalid?: boolean) => void;
  addBlock: (pos: Position3D) => void;
  removeBlock: (pos: Position3D) => void;
  undo: () => void;
  redo: () => void;
  clearAll: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

// ---------------------------------------------------------------------------
// Helpers for incremental spatial-index + hidden-face updates
// ---------------------------------------------------------------------------

function doAdd(
  blocks: Map<string, Block>,
  spatialIndex: SpatialIndex,
  hiddenFaces: Map<string, FaceMask>,
  key: string,
  block: Block,
): { blocks: Map<string, Block>; hiddenFaces: Map<string, FaceMask> } {
  // Mutate spatial index in place (not selected by React components)
  addToSpatialIndex(spatialIndex, block);
  // Clone blocks + hiddenFaces (new references trigger re-render)
  const newBlocks = new Map(blocks);
  newBlocks.set(key, block);
  const affected = recomputeAffectedHiddenFaces(block.pos, block.type, newBlocks, spatialIndex);
  const newHidden = new Map(hiddenFaces);
  for (const [k, v] of affected) newHidden.set(k, v);
  return { blocks: newBlocks, hiddenFaces: newHidden };
}

function doRemove(
  blocks: Map<string, Block>,
  spatialIndex: SpatialIndex,
  hiddenFaces: Map<string, FaceMask>,
  key: string,
  block: Block,
): { blocks: Map<string, Block>; hiddenFaces: Map<string, FaceMask> } {
  removeFromSpatialIndex(spatialIndex, block);
  const newBlocks = new Map(blocks);
  newBlocks.delete(key);
  const affected = recomputeAffectedHiddenFaces(block.pos, block.type, newBlocks, spatialIndex);
  const newHidden = new Map(hiddenFaces);
  newHidden.delete(key);
  for (const [k, v] of affected) newHidden.set(k, v);
  return { blocks: newBlocks, hiddenFaces: newHidden };
}

export const useBlockStore = create<BlockStore>((set, get) => ({
  blocks: new Map(),
  spatialIndex: new Map(),
  hiddenFaces: new Map(),
  history: [],
  future: [],
  mode: "place",
  cubeType: "XZZ",
  pipeVariant: null,
  hoveredGridPos: null,
  hoveredBlockType: null,
  hoveredInvalid: false,

  setMode: (mode) => set({ mode, hoveredGridPos: null, hoveredBlockType: null, hoveredInvalid: false }),
  setCubeType: (cubeType) => set({ cubeType, pipeVariant: null }),
  setPipeVariant: (variant) => set({ pipeVariant: variant, cubeType: PIPE_VARIANT_CANONICAL[variant] }),
  setHoveredGridPos: (pos, blockType, invalid) => set({ hoveredGridPos: pos, hoveredBlockType: blockType ?? null, hoveredInvalid: invalid ?? false }),

  addBlock: (pos) =>
    set((state) => {
      const store = get();
      let blockType: BlockType = store.cubeType;

      // If pipe variant selected, resolve to correct PipeType based on position
      if (store.pipeVariant) {
        const resolved = resolvePipeType(store.pipeVariant, pos);
        if (!resolved) return state;
        blockType = resolved;
      }

      // Validate position parity
      if (!isValidPos(pos, blockType)) return state;
      if (hasBlockOverlap(pos, blockType, state.blocks, state.spatialIndex)) return state;

      const key = posKey(pos);
      const block: Block = { pos, type: blockType };
      const { blocks, hiddenFaces } = doAdd(state.blocks, state.spatialIndex, state.hiddenFaces, key, block);
      const cmd: UndoCommand = { kind: "add", key, block };

      return {
        blocks,
        hiddenFaces,
        history: [...state.history, cmd].slice(-MAX_HISTORY),
        future: [],
      };
    }),

  removeBlock: (pos) =>
    set((state) => {
      const key = posKey(pos);
      const block = state.blocks.get(key);
      if (!block) return state;

      const { blocks, hiddenFaces } = doRemove(state.blocks, state.spatialIndex, state.hiddenFaces, key, block);
      const cmd: UndoCommand = { kind: "remove", key, block };

      return {
        blocks,
        hiddenFaces,
        history: [...state.history, cmd].slice(-MAX_HISTORY),
        future: [],
        hoveredGridPos: null,
      };
    }),

  undo: () =>
    set((state) => {
      if (state.history.length === 0) return state;
      const newHistory = [...state.history];
      const cmd = newHistory.pop()!;

      if (cmd.kind === "add") {
        const { blocks, hiddenFaces } = doRemove(state.blocks, state.spatialIndex, state.hiddenFaces, cmd.key, cmd.block);
        return {
          blocks,
          hiddenFaces,
          history: newHistory,
          future: [cmd, ...state.future].slice(0, MAX_HISTORY),
          hoveredGridPos: null,
        };
      }

      if (cmd.kind === "remove") {
        const { blocks, hiddenFaces } = doAdd(state.blocks, state.spatialIndex, state.hiddenFaces, cmd.key, cmd.block);
        return {
          blocks,
          hiddenFaces,
          history: newHistory,
          future: [cmd, ...state.future].slice(0, MAX_HISTORY),
          hoveredGridPos: null,
        };
      }

      // cmd.kind === "clear" — restore saved state, rebuild spatial index
      const newIndex = buildSpatialIndex(cmd.savedBlocks);
      return {
        blocks: cmd.savedBlocks,
        spatialIndex: newIndex,
        hiddenFaces: cmd.savedHiddenFaces,
        history: newHistory,
        future: [cmd, ...state.future].slice(0, MAX_HISTORY),
        hoveredGridPos: null,
      };
    }),

  redo: () =>
    set((state) => {
      if (state.future.length === 0) return state;
      const newFuture = [...state.future];
      const cmd = newFuture.shift()!;

      if (cmd.kind === "add") {
        const { blocks, hiddenFaces } = doAdd(state.blocks, state.spatialIndex, state.hiddenFaces, cmd.key, cmd.block);
        return {
          blocks,
          hiddenFaces,
          history: [...state.history, cmd],
          future: newFuture,
          hoveredGridPos: null,
        };
      }

      if (cmd.kind === "remove") {
        const { blocks, hiddenFaces } = doRemove(state.blocks, state.spatialIndex, state.hiddenFaces, cmd.key, cmd.block);
        return {
          blocks,
          hiddenFaces,
          history: [...state.history, cmd],
          future: newFuture,
          hoveredGridPos: null,
        };
      }

      // cmd.kind === "clear" — save current state, then clear
      const savedCmd: UndoCommand = {
        kind: "clear",
        savedBlocks: state.blocks,
        savedHiddenFaces: state.hiddenFaces,
      };
      return {
        blocks: new Map(),
        spatialIndex: new Map(),
        hiddenFaces: new Map(),
        history: [...state.history, savedCmd],
        future: newFuture,
        hoveredGridPos: null,
      };
    }),

  clearAll: () =>
    set((state) => {
      if (state.blocks.size === 0) return state;
      const cmd: UndoCommand = {
        kind: "clear",
        savedBlocks: state.blocks,
        savedHiddenFaces: state.hiddenFaces,
      };
      return {
        blocks: new Map(),
        spatialIndex: new Map(),
        hiddenFaces: new Map(),
        history: [...state.history, cmd].slice(-MAX_HISTORY),
        future: [],
        hoveredGridPos: null,
      };
    }),

  canUndo: () => get().history.length > 0,
  canRedo: () => get().future.length > 0,
}));
