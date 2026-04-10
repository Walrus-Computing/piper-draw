import { create } from "zustand";
import type { Position3D, Block, CubeType } from "../types";
import { posKey } from "../types";

export type Mode = "place" | "delete";

interface BlockStore {
  blocks: Map<string, Block>;
  mode: Mode;
  cubeType: CubeType;
  hoveredGridPos: Position3D | null;

  setMode: (mode: Mode) => void;
  setCubeType: (cubeType: CubeType) => void;
  setHoveredGridPos: (pos: Position3D | null) => void;
  addBlock: (pos: Position3D) => void;
  removeBlock: (pos: Position3D) => void;
}

export const useBlockStore = create<BlockStore>((set, get) => ({
  blocks: new Map(),
  mode: "place",
  cubeType: "XZZ",
  hoveredGridPos: null,

  setMode: (mode) => set({ mode }),
  setCubeType: (cubeType) => set({ cubeType }),
  setHoveredGridPos: (pos) => set({ hoveredGridPos: pos }),

  addBlock: (pos) =>
    set((state) => {
      const key = posKey(pos);
      if (state.blocks.has(key)) return state;
      const next = new Map(state.blocks);
      next.set(key, { pos, type: get().cubeType });
      return { blocks: next };
    }),

  removeBlock: (pos) =>
    set((state) => {
      const key = posKey(pos);
      if (!state.blocks.has(key)) return state;
      const next = new Map(state.blocks);
      next.delete(key);
      return { blocks: next };
    }),
}));
