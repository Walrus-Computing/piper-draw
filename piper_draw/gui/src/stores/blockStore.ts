import { create } from "zustand";
import type { Position3D, Block, BlockType } from "../types";
import { posKey, hasBlockOverlap } from "../types";

export type Mode = "place" | "delete";

const MAX_HISTORY = 100;

interface BlockStore {
  blocks: Map<string, Block>;
  history: Map<string, Block>[];
  future: Map<string, Block>[];
  mode: Mode;
  cubeType: BlockType;
  hoveredGridPos: Position3D | null;
  hoveredBlockType: BlockType | null;
  hoveredInvalid: boolean;

  setMode: (mode: Mode) => void;
  setCubeType: (cubeType: BlockType) => void;
  setHoveredGridPos: (pos: Position3D | null, blockType?: BlockType, invalid?: boolean) => void;
  addBlock: (pos: Position3D) => void;
  removeBlock: (pos: Position3D) => void;
  undo: () => void;
  redo: () => void;
  clearAll: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

export const useBlockStore = create<BlockStore>((set, get) => ({
  blocks: new Map(),
  history: [],
  future: [],
  mode: "place",
  cubeType: "XZZ",
  hoveredGridPos: null,
  hoveredBlockType: null,
  hoveredInvalid: false,

  setMode: (mode) => set({ mode, hoveredGridPos: null, hoveredBlockType: null, hoveredInvalid: false }),
  setCubeType: (cubeType) => set({ cubeType }),
  setHoveredGridPos: (pos, blockType, invalid) => set({ hoveredGridPos: pos, hoveredBlockType: blockType ?? null, hoveredInvalid: invalid ?? false }),

  addBlock: (pos) =>
    set((state) => {
      const newType = get().cubeType;
      if (hasBlockOverlap(pos, newType, state.blocks)) return state;
      const newHistory = [...state.history, new Map(state.blocks)].slice(-MAX_HISTORY);
      const next = new Map(state.blocks);
      next.set(posKey(pos), { pos, type: newType });
      return { blocks: next, history: newHistory, future: [] };
    }),

  removeBlock: (pos) =>
    set((state) => {
      const key = posKey(pos);
      if (!state.blocks.has(key)) return state;
      const newHistory = [...state.history, new Map(state.blocks)].slice(-MAX_HISTORY);
      const next = new Map(state.blocks);
      next.delete(key);
      return { blocks: next, history: newHistory, future: [], hoveredGridPos: null };
    }),

  undo: () =>
    set((state) => {
      if (state.history.length === 0) return state;
      const newHistory = [...state.history];
      const previous = newHistory.pop()!;
      return {
        blocks: previous,
        history: newHistory,
        future: [new Map(state.blocks), ...state.future],
        hoveredGridPos: null,
      };
    }),

  redo: () =>
    set((state) => {
      if (state.future.length === 0) return state;
      const newFuture = [...state.future];
      const next = newFuture.shift()!;
      return {
        blocks: next,
        history: [...state.history, new Map(state.blocks)],
        future: newFuture,
        hoveredGridPos: null,
      };
    }),

  clearAll: () =>
    set((state) => {
      if (state.blocks.size === 0) return state;
      const newHistory = [...state.history, new Map(state.blocks)].slice(-MAX_HISTORY);
      return { blocks: new Map(), history: newHistory, future: [], hoveredGridPos: null };
    }),

  canUndo: () => get().history.length > 0,
  canRedo: () => get().future.length > 0,
}));
