import { create } from "zustand";
import type { Position3D, Block, BlockType } from "../types";
import { posKey, hasBlockOverlap } from "../types";

export type Mode = "place" | "delete";

interface BlockStore {
  blocks: Map<string, Block>;
  mode: Mode;
  cubeType: BlockType;
  hoveredGridPos: Position3D | null;
  hoveredBlockType: BlockType | null;

  setMode: (mode: Mode) => void;
  setCubeType: (cubeType: BlockType) => void;
  setHoveredGridPos: (pos: Position3D | null, blockType?: BlockType) => void;
  addBlock: (pos: Position3D) => void;
  removeBlock: (pos: Position3D) => void;
}

export const useBlockStore = create<BlockStore>((set, get) => ({
  blocks: new Map(),
  mode: "place",
  cubeType: "XZZ",
  hoveredGridPos: null,
  hoveredBlockType: null,

  setMode: (mode) => set({ mode }),
  setCubeType: (cubeType) => set({ cubeType }),
  setHoveredGridPos: (pos, blockType) => set({ hoveredGridPos: pos, hoveredBlockType: blockType ?? null }),

  addBlock: (pos) =>
    set((state) => {
      const newType = get().cubeType;
      if (hasBlockOverlap(pos, newType, state.blocks)) return state;
      const next = new Map(state.blocks);
      next.set(posKey(pos), { pos, type: newType });
      return { blocks: next };
    }),

  removeBlock: (pos) =>
    set((state) => {
      const key = posKey(pos);
      if (!state.blocks.has(key)) return state;
      const next = new Map(state.blocks);
      next.delete(key);
      return { blocks: next, hoveredGridPos: null };
    }),
}));
