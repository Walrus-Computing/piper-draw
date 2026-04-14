import { create } from "zustand";
import type { Position3D, Block, BlockType, CubeType, PipeVariant, SpatialIndex, FaceMask } from "../types";
import {
  posKey,
  hasBlockOverlap,
  hasCubeColorConflict,
  hasPipeColorConflict,
  isPipeType,
  isValidPos,
  resolvePipeType,
  buildSpatialIndex,
  addToSpatialIndex,
  removeFromSpatialIndex,
  recomputeAffectedHiddenFaces,
  getHiddenFaceMaskForPos,
} from "../types";

export type Mode = "place" | "delete" | "select";

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
  | { kind: "bulk-remove"; entries: Array<{ key: string; block: Block }> }
  | { kind: "clear"; savedBlocks: Map<string, Block>; savedHiddenFaces: Map<string, FaceMask> }
  | { kind: "load"; savedBlocks: Map<string, Block>; savedHiddenFaces: Map<string, FaceMask>;
      newBlocks: Map<string, Block>; newIndex: SpatialIndex; newHiddenFaces: Map<string, FaceMask> };

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
  hoveredInvalidReason: string | null;
  selectedKeys: Set<string>;

  setMode: (mode: Mode) => void;
  setCubeType: (cubeType: BlockType) => void;
  setPipeVariant: (variant: PipeVariant) => void;
  setHoveredGridPos: (pos: Position3D | null, blockType?: BlockType, invalid?: boolean, reason?: string) => void;
  addBlock: (pos: Position3D) => void;
  removeBlock: (pos: Position3D) => void;
  undo: () => void;
  redo: () => void;
  loadBlocks: (blocks: Map<string, Block>) => void;
  clearAll: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  selectBlock: (pos: Position3D, additive: boolean) => void;
  clearSelection: () => void;
  deleteSelected: () => void;
  selectAll: () => void;
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
  hoveredInvalidReason: null,
  selectedKeys: new Set(),

  setMode: (mode) => set({
    mode,
    hoveredGridPos: null,
    hoveredBlockType: null,
    hoveredInvalid: false,
    hoveredInvalidReason: null,
    ...(mode === "place" ? { selectedKeys: new Set<string>() } : {}),
  }),
  setCubeType: (cubeType) => set({ cubeType, pipeVariant: null }),
  setPipeVariant: (variant) => set({ pipeVariant: variant, cubeType: PIPE_VARIANT_CANONICAL[variant] }),
  setHoveredGridPos: (pos, blockType, invalid, reason) => set((state) => {
    const bt = blockType ?? null;
    const inv = invalid ?? false;
    const rsn = reason ?? null;
    // Skip no-op updates to avoid unnecessary re-renders
    if (
      state.hoveredGridPos?.x === pos?.x &&
      state.hoveredGridPos?.y === pos?.y &&
      state.hoveredGridPos?.z === pos?.z &&
      state.hoveredBlockType === bt &&
      state.hoveredInvalid === inv &&
      state.hoveredInvalidReason === rsn
    ) return state;
    return { hoveredGridPos: pos, hoveredBlockType: bt, hoveredInvalid: inv, hoveredInvalidReason: rsn };
  }),

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
      if (isPipeType(blockType) && hasPipeColorConflict(blockType, pos, state.blocks)) return state;
      if (!isPipeType(blockType) && blockType !== "Y" && hasCubeColorConflict(blockType as CubeType, pos, state.blocks)) return state;

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

      if (cmd.kind === "bulk-remove") {
        let { blocks, hiddenFaces } = { blocks: state.blocks, hiddenFaces: state.hiddenFaces };
        for (const entry of cmd.entries) {
          ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, entry.key, entry.block));
        }
        return {
          blocks,
          hiddenFaces,
          history: newHistory,
          future: [cmd, ...state.future].slice(0, MAX_HISTORY),
          hoveredGridPos: null,
        };
      }

      if (cmd.kind === "load") {
        // Undo a load — restore the state before the import
        const newIndex = buildSpatialIndex(cmd.savedBlocks);
        return {
          blocks: cmd.savedBlocks,
          spatialIndex: newIndex,
          hiddenFaces: cmd.savedHiddenFaces,
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

      if (cmd.kind === "bulk-remove") {
        let { blocks, hiddenFaces } = { blocks: state.blocks, hiddenFaces: state.hiddenFaces };
        for (const entry of cmd.entries) {
          ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, entry.key, entry.block));
        }
        return {
          blocks,
          hiddenFaces,
          history: [...state.history, cmd],
          future: newFuture,
          hoveredGridPos: null,
          selectedKeys: new Set<string>(),
        };
      }

      if (cmd.kind === "load") {
        // Redo a load — restore the imported state
        return {
          blocks: cmd.newBlocks,
          spatialIndex: cmd.newIndex,
          hiddenFaces: cmd.newHiddenFaces,
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

  loadBlocks: (incoming) =>
    set((state) => {
      if (incoming.size === 0 && state.blocks.size === 0) return state;
      const newIndex = buildSpatialIndex(incoming);
      const newHidden: Map<string, FaceMask> = new Map();
      for (const [key, block] of incoming) {
        const mask = getHiddenFaceMaskForPos(block.pos, block.type, incoming, newIndex);
        if (mask !== 0) newHidden.set(key, mask);
      }
      const cmd: UndoCommand = {
        kind: "load",
        savedBlocks: state.blocks,
        savedHiddenFaces: state.hiddenFaces,
        newBlocks: incoming,
        newIndex,
        newHiddenFaces: newHidden,
      };
      return {
        blocks: incoming,
        spatialIndex: newIndex,
        hiddenFaces: newHidden,
        history: [...state.history, cmd].slice(-MAX_HISTORY),
        future: [],
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
        selectedKeys: new Set<string>(),
      };
    }),

  canUndo: () => get().history.length > 0,
  canRedo: () => get().future.length > 0,

  selectBlock: (pos, additive) =>
    set((state) => {
      const key = posKey(pos);
      if (!state.blocks.has(key)) return state;
      const next = additive ? new Set(state.selectedKeys) : new Set<string>();
      if (additive && next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return { selectedKeys: next };
    }),

  clearSelection: () =>
    set((state) => {
      if (state.selectedKeys.size === 0) return state;
      return { selectedKeys: new Set<string>() };
    }),

  deleteSelected: () =>
    set((state) => {
      if (state.selectedKeys.size === 0) return state;
      const entries: Array<{ key: string; block: Block }> = [];
      let { blocks, hiddenFaces } = { blocks: state.blocks, hiddenFaces: state.hiddenFaces };
      for (const key of state.selectedKeys) {
        const block = blocks.get(key);
        if (!block) continue;
        entries.push({ key, block });
        ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, key, block));
      }
      if (entries.length === 0) return state;
      const cmd: UndoCommand = { kind: "bulk-remove", entries };
      return {
        blocks,
        hiddenFaces,
        history: [...state.history, cmd].slice(-MAX_HISTORY),
        future: [],
        selectedKeys: new Set<string>(),
        hoveredGridPos: null,
      };
    }),

  selectAll: () =>
    set((state) => {
      if (state.blocks.size === 0) return state;
      return { selectedKeys: new Set(state.blocks.keys()) };
    }),
}));
