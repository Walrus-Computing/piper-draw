import { create } from "zustand";
import type {
  Position3D, Block, BlockType, CubeType, PipeVariant, PipeType, SpatialIndex, FaceMask,
  BuildDirection, UndeterminedCubeInfo,
} from "../types";
import {
  posKey,
  hasBlockOverlap,
  hasCubeColorConflict,
  hasPipeColorConflict,
  hasYCubePipeAxisConflict,
  isPipeType,
  isValidPos,
  resolvePipeType,
  buildSpatialIndex,
  addToSpatialIndex,
  removeFromSpatialIndex,
  recomputeAffectedHiddenFaces,
  getHiddenFaceMaskForPos,
  computeDestCubePos,
  computePipePos,
  inferPipeType,
  determineCubeOptions,
  cameraAzimuthForDirection,
  CUBE_TYPES,
  PIPE_TYPES,
  tqecToThree,
} from "../types";

export type Mode = "place" | "delete" | "select" | "build";

const MAX_HISTORY = 100;

/** Canonical X-open PipeType for each variant, used as cubeType fallback. */
const PIPE_VARIANT_CANONICAL: Record<PipeVariant, BlockType> = {
  ZX: "OZX", XZ: "OXZ", ZXH: "OZXH", XZH: "OXZH",
};

// ---------------------------------------------------------------------------
// Command-based undo — stores the operation, not a full state snapshot.
// Add/remove commands are O(1) memory; clear saves the full map (rare).
// ---------------------------------------------------------------------------

/** Captures one keyboard-build step for atomic undo. */
export type BuildStep = {
  prevCursorPos: Position3D;
  /** Pipe placed (null if pipe already existed). */
  pipe: { key: string; block: Block } | null;
  /** Cube placed at destination (null if cube already existed). */
  cube: { key: string; block: Block } | null;
  /** Origin cube placed on empty canvas (first step only). */
  originCube?: { key: string; block: Block };
  /** If the source cube was auto-determined during this step. */
  sourceDetermination?: {
    key: string;
    prevType: CubeType;
    prevUndeterminedInfo: UndeterminedCubeInfo;
  };
  /** If the destination cube is undetermined after this step. */
  destUndetermined?: UndeterminedCubeInfo;
  /** If an existing destination cube was re-typed to accommodate the new pipe. */
  destTypeChange?: { key: string; prevType: CubeType; newType: CubeType };
};

type UndoCommand =
  | { kind: "add"; key: string; block: Block }
  | { kind: "remove"; key: string; block: Block }
  | { kind: "bulk-remove"; entries: Array<{ key: string; block: Block }> }
  | { kind: "clear"; savedBlocks: Map<string, Block>; savedHiddenFaces: Map<string, FaceMask> }
  | { kind: "load"; savedBlocks: Map<string, Block>; savedHiddenFaces: Map<string, FaceMask>;
      newBlocks: Map<string, Block>; newIndex: SpatialIndex; newHiddenFaces: Map<string, FaceMask> }
  | { kind: "build-step"; step: BuildStep }
  | { kind: "hadamard-toggle"; pipeKey: string; oldType: PipeType; newType: PipeType;
      retyped?: Array<{ cubeKey: string; oldType: CubeType; newType: CubeType;
        oldUndetermined?: UndeterminedCubeInfo; newUndetermined?: UndeterminedCubeInfo }> }
  | { kind: "cube-cycle"; cubeKey: string; oldType: CubeType; newType: CubeType;
      oldPipes?: Array<{ key: string; oldType: PipeType; newType: PipeType }> };

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

  // Build mode state
  buildCursor: Position3D | null;
  buildHistory: BuildStep[];
  undeterminedCubes: Map<string, UndeterminedCubeInfo>;
  /** Camera snap target set by build actions, consumed by CameraBuildSnap component. */
  cameraSnapTarget: { azimuth: number | null; targetPos: Position3D } | null;

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

  // Build mode actions
  buildMove: (direction: BuildDirection) => boolean;
  undoBuildStep: () => void;
  cycleCubeType: () => void;
  toggleHadamard: () => void;
  moveBuildCursor: (pos: Position3D) => void;
  clearCameraSnap: () => void;
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

  // Build mode state
  buildCursor: null,
  buildHistory: [],
  undeterminedCubes: new Map(),
  cameraSnapTarget: null,

  setMode: (mode) => {
    const prev = get();

    // Leaving build mode: commit undetermined cubes to their current type
    if (prev.mode === "build" && mode !== "build") {
      set({
        mode,
        buildCursor: null,
        buildHistory: [],
        undeterminedCubes: new Map(),
        cameraSnapTarget: null,
        hoveredGridPos: null,
        hoveredBlockType: null,
        hoveredInvalid: false,
        hoveredInvalidReason: null,
        selectedKeys: new Set<string>(),
      });
      return;
    }

    // Entering build mode: place cursor on last-placed cube or origin
    if (mode === "build") {
      let cursorPos: Position3D = { x: 0, y: 0, z: 0 };

      // Find the most recently placed cube by scanning history backwards
      for (let i = prev.history.length - 1; i >= 0; i--) {
        const cmd = prev.history[i];
        if (cmd.kind === "add" && !isPipeType(cmd.block.type) && cmd.block.type !== "Y") {
          cursorPos = cmd.block.pos;
          break;
        }
        if (cmd.kind === "build-step") {
          if (cmd.step.cube) { cursorPos = cmd.step.cube.block.pos; break; }
          if (cmd.step.originCube) { cursorPos = cmd.step.originCube.block.pos; break; }
        }
      }

      set({
        mode,
        buildCursor: cursorPos,
        buildHistory: [],
        undeterminedCubes: new Map(),
        cameraSnapTarget: null,
        hoveredGridPos: null,
        hoveredBlockType: null,
        hoveredInvalid: false,
        hoveredInvalidReason: null,
        selectedKeys: new Set<string>(),
      });
      return;
    }

    set({
      mode,
      hoveredGridPos: null,
      hoveredBlockType: null,
      hoveredInvalid: false,
      hoveredInvalidReason: null,
      ...(mode === "place" ? { selectedKeys: new Set<string>() } : {}),
    });
  },
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
      if (hasYCubePipeAxisConflict(blockType, pos, state.blocks)) return state;

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

      if (cmd.kind === "build-step") {
        const step = cmd.step;
        let { blocks, hiddenFaces } = { blocks: state.blocks, hiddenFaces: state.hiddenFaces };
        const newUndetermined = new Map(state.undeterminedCubes);

        // Remove dest cube
        if (step.cube) {
          ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, step.cube.key, step.cube.block));
          newUndetermined.delete(step.cube.key);
        }
        // Revert dest type change
        if (step.destTypeChange) {
          const dtc = step.destTypeChange;
          const curDest = blocks.get(dtc.key);
          if (curDest) {
            ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, dtc.key, curDest));
            ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, dtc.key, { pos: curDest.pos, type: dtc.prevType }));
          }
        }
        // Remove pipe
        if (step.pipe) {
          ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, step.pipe.key, step.pipe.block));
        }
        // Revert source determination
        if (step.sourceDetermination) {
          const sd = step.sourceDetermination;
          const curSrc = blocks.get(sd.key);
          if (curSrc) ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, sd.key, curSrc));
          const reverted: Block = { pos: step.prevCursorPos, type: sd.prevType };
          ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, sd.key, reverted));
          newUndetermined.set(sd.key, { ...sd.prevUndeterminedInfo, options: [...sd.prevUndeterminedInfo.options] });
        }
        // Remove origin cube
        if (step.originCube) {
          ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, step.originCube.key, step.originCube.block));
          newUndetermined.delete(step.originCube.key);
        }

        const newBuildHistory = [...state.buildHistory];
        if (newBuildHistory.length > 0) newBuildHistory.pop();

        return {
          blocks,
          hiddenFaces,
          history: newHistory,
          future: [cmd, ...state.future].slice(0, MAX_HISTORY),
          hoveredGridPos: null,
          buildCursor: state.mode === "build" ? step.prevCursorPos : state.buildCursor,
          buildHistory: newBuildHistory,
          undeterminedCubes: newUndetermined,
        };
      }

      if (cmd.kind === "hadamard-toggle") {
        let { blocks, hiddenFaces } = { blocks: state.blocks, hiddenFaces: state.hiddenFaces };
        const newUndetermined = new Map(state.undeterminedCubes);

        const pipeBlock = blocks.get(cmd.pipeKey);
        if (pipeBlock) {
          ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, cmd.pipeKey, pipeBlock));
          ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, cmd.pipeKey, { pos: pipeBlock.pos, type: cmd.oldType }));
        }
        if (cmd.retyped) {
          for (const rd of cmd.retyped) {
            const cubeBlock = blocks.get(rd.cubeKey);
            if (cubeBlock) {
              ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, rd.cubeKey, cubeBlock));
              ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, rd.cubeKey, { pos: cubeBlock.pos, type: rd.oldType }));
            }
            if (rd.oldUndetermined) newUndetermined.set(rd.cubeKey, rd.oldUndetermined);
            else newUndetermined.delete(rd.cubeKey);
          }
        }
        return { blocks, hiddenFaces, history: newHistory, future: [cmd, ...state.future].slice(0, MAX_HISTORY), undeterminedCubes: newUndetermined, hoveredGridPos: null };
      }

      if (cmd.kind === "cube-cycle") {
        let { blocks, hiddenFaces } = { blocks: state.blocks, hiddenFaces: state.hiddenFaces };
        const newUndetermined = new Map(state.undeterminedCubes);

        const cubeBlock = blocks.get(cmd.cubeKey);
        if (cubeBlock) {
          ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, cmd.cubeKey, cubeBlock));
          ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, cmd.cubeKey, { pos: cubeBlock.pos, type: cmd.oldType }));
        }
        // Revert pipe updates
        if (cmd.oldPipes) {
          for (const pu of cmd.oldPipes) {
            const pb = blocks.get(pu.key);
            if (pb) {
              ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, pu.key, pb));
              ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, pu.key, { pos: pb.pos, type: pu.oldType }));
            }
          }
        }
        // Restore undetermined index
        const info = newUndetermined.get(cmd.cubeKey);
        if (info) {
          const idx = info.options.indexOf(cmd.oldType);
          if (idx >= 0) newUndetermined.set(cmd.cubeKey, { ...info, currentIndex: idx });
        }
        return { blocks, hiddenFaces, history: newHistory, future: [cmd, ...state.future].slice(0, MAX_HISTORY), undeterminedCubes: newUndetermined, hoveredGridPos: null };
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

      if (cmd.kind === "build-step") {
        const step = cmd.step;
        let { blocks, hiddenFaces } = { blocks: state.blocks, hiddenFaces: state.hiddenFaces };
        const newUndetermined = new Map(state.undeterminedCubes);

        // Re-place origin cube
        if (step.originCube) {
          ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, step.originCube.key, step.originCube.block));
        }
        // Re-determine source
        if (step.sourceDetermination) {
          const sd = step.sourceDetermination;
          const curSrc = blocks.get(sd.key);
          if (curSrc) ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, sd.key, curSrc));
          // Re-determine using constraints from adjacent pipes (pipe not yet re-placed)
          const newSrcOptions = determineCubeOptions(step.prevCursorPos, blocks);
          const srcType = newSrcOptions.determined ? newSrcOptions.type : (newSrcOptions.options[0] ?? sd.prevType);
          ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, sd.key, { pos: step.prevCursorPos, type: srcType }));
          newUndetermined.delete(sd.key);
        }
        // Re-place pipe
        if (step.pipe) {
          ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, step.pipe.key, step.pipe.block));
        }
        // Re-apply dest type change
        if (step.destTypeChange) {
          const dtc = step.destTypeChange;
          const curDest = blocks.get(dtc.key);
          if (curDest) {
            ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, dtc.key, curDest));
            ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, dtc.key, { pos: curDest.pos, type: dtc.newType }));
          }
        }
        // Re-place dest cube
        if (step.cube) {
          ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, step.cube.key, step.cube.block));
          if (step.destUndetermined) newUndetermined.set(step.cube.key, step.destUndetermined);
        }

        const newBuildHistory = [...state.buildHistory, step];
        const destPos = step.cube ? step.cube.block.pos : computeDestCubePos(step.prevCursorPos, { tqecAxis: 0, sign: 1 }); // fallback

        return {
          blocks,
          hiddenFaces,
          history: [...state.history, cmd],
          future: newFuture,
          hoveredGridPos: null,
          buildCursor: step.cube ? step.cube.block.pos : state.buildCursor,
          buildHistory: newBuildHistory,
          undeterminedCubes: newUndetermined,
        };
      }

      if (cmd.kind === "hadamard-toggle") {
        let { blocks, hiddenFaces } = { blocks: state.blocks, hiddenFaces: state.hiddenFaces };
        const newUndetermined = new Map(state.undeterminedCubes);

        const pipeBlock = blocks.get(cmd.pipeKey);
        if (pipeBlock) {
          ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, cmd.pipeKey, pipeBlock));
          ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, cmd.pipeKey, { pos: pipeBlock.pos, type: cmd.newType }));
        }
        if (cmd.retyped) {
          for (const rd of cmd.retyped) {
            const cubeBlock = blocks.get(rd.cubeKey);
            if (cubeBlock) {
              ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, rd.cubeKey, cubeBlock));
              ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, rd.cubeKey, { pos: cubeBlock.pos, type: rd.newType }));
            }
            if (rd.newUndetermined) newUndetermined.set(rd.cubeKey, rd.newUndetermined);
            else newUndetermined.delete(rd.cubeKey);
          }
        }
        return { blocks, hiddenFaces, history: [...state.history, cmd], future: newFuture, undeterminedCubes: newUndetermined, hoveredGridPos: null };
      }

      if (cmd.kind === "cube-cycle") {
        let { blocks, hiddenFaces } = { blocks: state.blocks, hiddenFaces: state.hiddenFaces };
        const newUndetermined = new Map(state.undeterminedCubes);

        const cubeBlock = blocks.get(cmd.cubeKey);
        if (cubeBlock) {
          ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, cmd.cubeKey, cubeBlock));
          ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, cmd.cubeKey, { pos: cubeBlock.pos, type: cmd.newType }));
        }
        if (cmd.oldPipes) {
          for (const pu of cmd.oldPipes) {
            const pb = blocks.get(pu.key);
            if (pb) {
              ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, pu.key, pb));
              ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, pu.key, { pos: pb.pos, type: pu.newType }));
            }
          }
        }
        const info = newUndetermined.get(cmd.cubeKey);
        if (info) {
          const idx = info.options.indexOf(cmd.newType);
          if (idx >= 0) newUndetermined.set(cmd.cubeKey, { ...info, currentIndex: idx });
        }
        return { blocks, hiddenFaces, history: [...state.history, cmd], future: newFuture, undeterminedCubes: newUndetermined, hoveredGridPos: null };
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

  // ---------------------------------------------------------------------------
  // Build mode actions
  // ---------------------------------------------------------------------------

  buildMove: (direction) => {
    const state = get();
    if (state.mode !== "build" || !state.buildCursor) return false;

    const cursor = state.buildCursor;
    const pipePos = computePipePos(cursor, direction);
    const destPos = computeDestCubePos(cursor, direction);
    const pipeKey = posKey(pipePos);
    const destKey = posKey(destPos);
    const srcKey = posKey(cursor);

    // If pipe already exists, just move cursor to destination if it has a cube
    const existingPipe = state.blocks.get(pipeKey);
    if (existingPipe) {
      const existingDest = state.blocks.get(destKey);
      if (existingDest && !isPipeType(existingDest.type)) {
        const azimuth = cameraAzimuthForDirection(direction);
        set({
          buildCursor: destPos,
          cameraSnapTarget: { azimuth, targetPos: destPos },
        });
        return true;
      }
      return false;
    }

    const srcBlock = state.blocks.get(srcKey);
    const isEmptyOrigin = !srcBlock;
    const isUndetermined = !isEmptyOrigin && state.undeterminedCubes.has(srcKey);

    // Determine source cube type
    let srcType: CubeType;
    let sourceDetermination: BuildStep["sourceDetermination"];

    if (isEmptyOrigin) {
      // First step on empty canvas — pick a valid cube type for this build axis
      const validOrigin = CUBE_TYPES.filter(ct => inferPipeType(ct, direction.tqecAxis) !== null);
      if (validOrigin.length === 0) return false;
      srcType = validOrigin[0];
    } else if (srcBlock!.type === "Y" || isPipeType(srcBlock!.type)) {
      return false;
    } else if (isUndetermined) {
      // Source is undetermined — always commit when building away.
      // Filter to options that can pipe on this axis.
      const info = state.undeterminedCubes.get(srcKey)!;
      const validForDir = info.options.filter(opt => inferPipeType(opt, direction.tqecAxis) !== null);
      if (validForDir.length === 0) return false;

      // Check if all valid options produce the same pipe type
      const pipeSet = new Set(validForDir.map(opt => inferPipeType(opt, direction.tqecAxis)));
      if (pipeSet.size > 1) return false; // Truly ambiguous — different pipe types, must cycle (R)

      // Prefer current type if it's valid for this direction
      const currentType = srcBlock!.type as CubeType;
      srcType = validForDir.includes(currentType) ? currentType : validForDir[0];
      // Always determine source — commit to chosen type
      sourceDetermination = {
        key: srcKey,
        prevType: currentType,
        prevUndeterminedInfo: { ...info, options: [...info.options] },
      };
    } else {
      srcType = srcBlock!.type as CubeType;
    }

    // Infer pipe type from source
    const pipeType = inferPipeType(srcType, direction.tqecAxis);
    if (!pipeType) return false;

    // Validate pipe position and overlap
    if (!isValidPos(pipePos, pipeType)) return false;
    if (hasBlockOverlap(pipePos, pipeType, state.blocks, state.spatialIndex)) return false;

    // Y cube pipe axis conflict: Y cubes only work with Z-open pipes
    if (hasYCubePipeAxisConflict(pipeType, pipePos, state.blocks)) return false;

    // Check if destination already has a cube
    const existingDest = state.blocks.get(destKey);
    let destTypeChange: BuildStep["destTypeChange"];
    if (existingDest) {
      if (existingDest.type === "Y" || isPipeType(existingDest.type)) return false;
      // Destination exists — check if current type is compatible, auto-retype if needed
      const tmpBlocks = new Map(state.blocks);
      if (sourceDetermination || isEmptyOrigin) {
        tmpBlocks.set(srcKey, { pos: cursor, type: srcType });
      }
      tmpBlocks.set(pipeKey, { pos: pipePos, type: pipeType });
      const destOptions = determineCubeOptions(destPos, tmpBlocks);
      const currentDestType = existingDest.type as CubeType;
      if (destOptions.determined) {
        if (destOptions.type !== currentDestType) {
          destTypeChange = { key: destKey, prevType: currentDestType, newType: destOptions.type };
        }
      } else if (destOptions.options.includes(currentDestType)) {
        // Current type is still valid — keep it
      } else if (destOptions.options.length > 0) {
        destTypeChange = { key: destKey, prevType: currentDestType, newType: destOptions.options[0] };
      } else {
        return false; // No valid type exists for dest with this pipe
      }
    } else {
      // Validate destination position and check for overlap with non-cube blocks
      if (!isValidPos(destPos, "XZZ")) return false;
      if (hasBlockOverlap(destPos, "XZZ", state.blocks, state.spatialIndex)) return false;
    }

    // All validation passed — apply mutations
    set((s) => {
      let { blocks, hiddenFaces } = { blocks: s.blocks, hiddenFaces: s.hiddenFaces };
      const newUndetermined = new Map(s.undeterminedCubes);
      let originCubeEntry: BuildStep["originCube"];

      // Place origin cube on empty canvas (always determined — no ghost)
      if (isEmptyOrigin) {
        const originBlock: Block = { pos: cursor, type: srcType };
        ({ blocks, hiddenFaces } = doAdd(blocks, s.spatialIndex, hiddenFaces, srcKey, originBlock));
        originCubeEntry = { key: srcKey, block: originBlock };
      }

      // Apply source determination (commit undetermined source to chosen type)
      if (sourceDetermination) {
        const oldSrc = blocks.get(srcKey)!;
        ({ blocks, hiddenFaces } = doRemove(blocks, s.spatialIndex, hiddenFaces, srcKey, oldSrc));
        const newSrc: Block = { pos: cursor, type: srcType };
        ({ blocks, hiddenFaces } = doAdd(blocks, s.spatialIndex, hiddenFaces, srcKey, newSrc));
        newUndetermined.delete(srcKey);
      }

      // Place pipe
      const pipeBlock: Block = { pos: pipePos, type: pipeType };
      ({ blocks, hiddenFaces } = doAdd(blocks, s.spatialIndex, hiddenFaces, pipeKey, pipeBlock));

      // Apply dest type change if existing cube needs re-typing
      if (destTypeChange) {
        const oldDest = blocks.get(destTypeChange.key)!;
        ({ blocks, hiddenFaces } = doRemove(blocks, s.spatialIndex, hiddenFaces, destTypeChange.key, oldDest));
        const newDest: Block = { pos: oldDest.pos, type: destTypeChange.newType };
        ({ blocks, hiddenFaces } = doAdd(blocks, s.spatialIndex, hiddenFaces, destTypeChange.key, newDest));
      }

      // Handle destination
      let cubeAdded: BuildStep["cube"] = null;
      let destUndetermined: UndeterminedCubeInfo | undefined;

      if (!existingDest) {
        // Determine destination cube type
        const destOptions = determineCubeOptions(destPos, blocks);
        let destType: CubeType;
        if (destOptions.determined) {
          destType = destOptions.type;
        } else if (destOptions.options.length > 0) {
          destType = destOptions.options[0];
          destUndetermined = { options: [...destOptions.options], currentIndex: 0 };
          newUndetermined.set(destKey, destUndetermined);
        } else {
          // Shouldn't happen — pipe was valid
          destType = srcType;
        }
        const destBlock: Block = { pos: destPos, type: destType };
        ({ blocks, hiddenFaces } = doAdd(blocks, s.spatialIndex, hiddenFaces, destKey, destBlock));
        cubeAdded = { key: destKey, block: destBlock };
      }

      const step: BuildStep = {
        prevCursorPos: cursor,
        pipe: { key: pipeKey, block: pipeBlock },
        cube: cubeAdded,
        originCube: originCubeEntry,
        sourceDetermination,
        destUndetermined,
        destTypeChange,
      };

      const azimuth = cameraAzimuthForDirection(direction);

      return {
        blocks,
        hiddenFaces,
        buildCursor: destPos,
        buildHistory: [...s.buildHistory, step],
        undeterminedCubes: newUndetermined,
        cameraSnapTarget: { azimuth, targetPos: destPos },
        history: [...s.history, { kind: "build-step" as const, step }].slice(-MAX_HISTORY),
        future: [],
      };
    });
    return true;
  },

  undoBuildStep: () => {
    const state = get();
    if (state.mode !== "build" || state.buildHistory.length === 0) return;

    set((s) => {
      if (s.buildHistory.length === 0) return s;
      const newBuildHistory = [...s.buildHistory];
      const step = newBuildHistory.pop()!;

      let { blocks, hiddenFaces } = { blocks: s.blocks, hiddenFaces: s.hiddenFaces };
      const newUndetermined = new Map(s.undeterminedCubes);

      // Remove destination cube if we placed it
      if (step.cube) {
        ({ blocks, hiddenFaces } = doRemove(blocks, s.spatialIndex, hiddenFaces, step.cube.key, step.cube.block));
        newUndetermined.delete(step.cube.key);
      }

      // Revert dest type change (restore original type)
      if (step.destTypeChange) {
        const dtc = step.destTypeChange;
        const curDest = blocks.get(dtc.key);
        if (curDest) {
          ({ blocks, hiddenFaces } = doRemove(blocks, s.spatialIndex, hiddenFaces, dtc.key, curDest));
          ({ blocks, hiddenFaces } = doAdd(blocks, s.spatialIndex, hiddenFaces, dtc.key, { pos: curDest.pos, type: dtc.prevType }));
        }
      }

      // Remove pipe
      if (step.pipe) {
        ({ blocks, hiddenFaces } = doRemove(blocks, s.spatialIndex, hiddenFaces, step.pipe.key, step.pipe.block));
      }

      // Revert source determination
      if (step.sourceDetermination) {
        const sd = step.sourceDetermination;
        const curSrc = blocks.get(sd.key);
        if (curSrc) {
          ({ blocks, hiddenFaces } = doRemove(blocks, s.spatialIndex, hiddenFaces, sd.key, curSrc));
        }
        const reverted: Block = { pos: step.prevCursorPos, type: sd.prevType };
        ({ blocks, hiddenFaces } = doAdd(blocks, s.spatialIndex, hiddenFaces, sd.key, reverted));
        newUndetermined.set(sd.key, { ...sd.prevUndeterminedInfo, options: [...sd.prevUndeterminedInfo.options] });
      }

      // Remove origin cube if this was first step
      if (step.originCube) {
        ({ blocks, hiddenFaces } = doRemove(blocks, s.spatialIndex, hiddenFaces, step.originCube.key, step.originCube.block));
        newUndetermined.delete(step.originCube.key);
      }

      // Also pop from general undo history if the last command is a matching build-step
      const newHistory = [...s.history];
      if (newHistory.length > 0 && newHistory[newHistory.length - 1].kind === "build-step") {
        const cmd = newHistory.pop()!;
        return {
          blocks,
          hiddenFaces,
          buildCursor: step.prevCursorPos,
          buildHistory: newBuildHistory,
          undeterminedCubes: newUndetermined,
          cameraSnapTarget: { azimuth: null, targetPos: step.prevCursorPos },
          history: newHistory,
          future: [cmd, ...s.future].slice(0, MAX_HISTORY),
          hoveredGridPos: null,
        };
      }

      return {
        blocks,
        hiddenFaces,
        buildCursor: step.prevCursorPos,
        buildHistory: newBuildHistory,
        undeterminedCubes: newUndetermined,
        cameraSnapTarget: { azimuth: null, targetPos: step.prevCursorPos },
        hoveredGridPos: null,
      };
    });
  },

  cycleCubeType: () =>
    set((state) => {
      if (state.mode !== "build" || !state.buildCursor) return state;
      const cursorKey = posKey(state.buildCursor);
      const info = state.undeterminedCubes.get(cursorKey);
      if (!info || info.options.length <= 1) return state;

      const block = state.blocks.get(cursorKey);
      if (!block) return state;

      const oldType = block.type as CubeType;
      const newIndex = (info.currentIndex + 1) % info.options.length;
      const newType = info.options[newIndex];

      // Replace cube block with new type
      let { blocks, hiddenFaces } = { blocks: state.blocks, hiddenFaces: state.hiddenFaces };
      ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, cursorKey, block));
      const newBlock: Block = { pos: state.buildCursor, type: newType };
      ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, cursorKey, newBlock));

      // Update adjacent pipes to match new cube type, validating far-end compatibility
      const pipeUpdates: Array<{ key: string; oldType: PipeType; newType: PipeType }> = [];
      const coords: [number, number, number] = [state.buildCursor.x, state.buildCursor.y, state.buildCursor.z];

      // First pass: check all pipe updates are valid before mutating
      for (let axis = 0; axis < 3; axis++) {
        for (const pipeOffset of [1, -2]) {
          const nCoords: [number, number, number] = [coords[0], coords[1], coords[2]];
          nCoords[axis] += pipeOffset;
          const nKey = posKey({ x: nCoords[0], y: nCoords[1], z: nCoords[2] });
          const neighbor = blocks.get(nKey);
          if (!neighbor || !isPipeType(neighbor.type)) continue;

          const base = neighbor.type.replace("H", "");
          const hadamard = neighbor.type.length > 3;
          const openAxis = base.indexOf("O");
          if (openAxis !== axis) continue;

          const newPipe = inferPipeType(newType, axis as 0 | 1 | 2);
          if (!newPipe) {
            // Can't create valid pipe on this axis with new type — reject cycle
            // Revert the cube change
            ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, cursorKey, newBlock));
            ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, cursorKey, block));
            return state;
          }
          const newPipeType = hadamard ? (newPipe + "H") as PipeType : newPipe;
          if (newPipeType === neighbor.type) continue;

          // Validate new pipe against the far-end cube
          const tmpBlocks = new Map(blocks);
          tmpBlocks.set(nKey, { pos: neighbor.pos, type: newPipeType });
          if (hasPipeColorConflict(newPipeType, neighbor.pos, tmpBlocks)) {
            // Conflict with far-end cube — reject cycle
            ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, cursorKey, newBlock));
            ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, cursorKey, block));
            return state;
          }

          pipeUpdates.push({ key: nKey, oldType: neighbor.type as PipeType, newType: newPipeType });
        }
      }

      // All valid — apply pipe mutations
      for (const pu of pipeUpdates) {
        const pipeBlock = blocks.get(pu.key)!;
        ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, pu.key, pipeBlock));
        ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, pu.key, { pos: pipeBlock.pos, type: pu.newType }));
      }

      const newUndetermined = new Map(state.undeterminedCubes);
      newUndetermined.set(cursorKey, { ...info, currentIndex: newIndex });

      const cmd: UndoCommand = { kind: "cube-cycle", cubeKey: cursorKey, oldType, newType, oldPipes: pipeUpdates };
      return {
        blocks,
        hiddenFaces,
        undeterminedCubes: newUndetermined,
        history: [...state.history, cmd].slice(-MAX_HISTORY),
        future: [],
      };
    }),

  toggleHadamard: () => {
    const state = get();
    if (state.mode !== "build" || state.buildHistory.length === 0) return;

    // Find last pipe in build history
    const lastStep = state.buildHistory[state.buildHistory.length - 1];
    if (!lastStep.pipe) return;

    const pipeKey = lastStep.pipe.key;
    const pipeBlock = state.blocks.get(pipeKey);
    if (!pipeBlock || !isPipeType(pipeBlock.type)) return;

    const oldPipeType = pipeBlock.type as PipeType;
    const isHadamard = oldPipeType.length > 3;
    const newPipeType = (isHadamard ? oldPipeType.slice(0, 3) : oldPipeType + "H") as PipeType;

    if (!(PIPE_TYPES as readonly string[]).includes(newPipeType)) return;

    // --- Dry-run pass: validate all neighbors using a temp blocks map ---
    // No spatial index mutations happen here.
    const tmpBlocks = new Map(state.blocks);
    tmpBlocks.set(pipeKey, { pos: pipeBlock.pos, type: newPipeType });

    const base = newPipeType.replace("H", "");
    const openAxis = base.indexOf("O");
    const pipeCoords: [number, number, number] = [pipeBlock.pos.x, pipeBlock.pos.y, pipeBlock.pos.z];

    type RetypeEntry = { key: string; pos: Position3D; oldType: CubeType; newType: CubeType;
      oldUndetermined?: UndeterminedCubeInfo; newUndetermined?: UndeterminedCubeInfo };
    const planned: RetypeEntry[] = [];

    for (const offset of [-1, 2]) {
      const nCoords: [number, number, number] = [pipeCoords[0], pipeCoords[1], pipeCoords[2]];
      nCoords[openAxis] += offset;
      const nKey = posKey({ x: nCoords[0], y: nCoords[1], z: nCoords[2] });
      const neighbor = tmpBlocks.get(nKey);
      if (!neighbor || isPipeType(neighbor.type) || neighbor.type === "Y") continue;

      const cubeInfo = state.undeterminedCubes.get(nKey);
      const newOptions = determineCubeOptions(neighbor.pos, tmpBlocks);
      const currentType = neighbor.type as CubeType;

      if (newOptions.determined) {
        if (newOptions.type !== currentType) {
          planned.push({ key: nKey, pos: neighbor.pos, oldType: currentType, newType: newOptions.type,
            oldUndetermined: cubeInfo, newUndetermined: undefined });
        }
      } else if (newOptions.options.length > 0) {
        if (!newOptions.options.includes(currentType)) {
          const newInfo = cubeInfo ? { options: [...newOptions.options], currentIndex: 0 } : undefined;
          planned.push({ key: nKey, pos: neighbor.pos, oldType: currentType, newType: newOptions.options[0],
            oldUndetermined: cubeInfo, newUndetermined: newInfo });
        }
        // else: current type still valid, no retype needed
      } else {
        // No valid type — reject Hadamard toggle. No mutations happened.
        return;
      }
    }

    // --- All validated, now apply actual mutations ---
    set((s) => {
      let { blocks, hiddenFaces } = { blocks: s.blocks, hiddenFaces: s.hiddenFaces };
      const newUndetermined = new Map(s.undeterminedCubes);

      // Toggle pipe
      ({ blocks, hiddenFaces } = doRemove(blocks, s.spatialIndex, hiddenFaces, pipeKey, pipeBlock));
      const newPipeBlock: Block = { pos: pipeBlock.pos, type: newPipeType };
      ({ blocks, hiddenFaces } = doAdd(blocks, s.spatialIndex, hiddenFaces, pipeKey, newPipeBlock));

      // Apply planned retypes
      const retyped: Array<{ cubeKey: string; oldType: CubeType; newType: CubeType;
        oldUndetermined?: UndeterminedCubeInfo; newUndetermined?: UndeterminedCubeInfo }> = [];
      for (const p of planned) {
        const cur = blocks.get(p.key);
        if (cur) {
          ({ blocks, hiddenFaces } = doRemove(blocks, s.spatialIndex, hiddenFaces, p.key, cur));
          ({ blocks, hiddenFaces } = doAdd(blocks, s.spatialIndex, hiddenFaces, p.key, { pos: p.pos, type: p.newType }));
        }
        if (p.newUndetermined) newUndetermined.set(p.key, p.newUndetermined);
        else if (p.oldUndetermined) newUndetermined.delete(p.key);
        retyped.push({ cubeKey: p.key, oldType: p.oldType, newType: p.newType,
          oldUndetermined: p.oldUndetermined, newUndetermined: p.newUndetermined });
      }

      // Update undetermined info for neighbors that didn't need retyping but are undetermined
      for (const offset of [-1, 2]) {
        const nCoords: [number, number, number] = [pipeCoords[0], pipeCoords[1], pipeCoords[2]];
        nCoords[openAxis] += offset;
        const nKey = posKey({ x: nCoords[0], y: nCoords[1], z: nCoords[2] });
        if (planned.some(p => p.key === nKey)) continue; // already handled
        const cubeInfo = newUndetermined.get(nKey);
        if (!cubeInfo) continue;
        const neighbor = blocks.get(nKey);
        if (!neighbor) continue;
        const newOptions = determineCubeOptions(neighbor.pos, blocks);
        if (newOptions.determined) {
          newUndetermined.delete(nKey);
        } else if (newOptions.options.length > 0) {
          const idx = Math.max(0, newOptions.options.indexOf(neighbor.type as CubeType));
          newUndetermined.set(nKey, { options: [...newOptions.options], currentIndex: idx });
        }
      }

      // Update the build history's last step to reflect new pipe type
      const newBuildHistory = [...s.buildHistory];
      const lastH = { ...newBuildHistory[newBuildHistory.length - 1] };
      lastH.pipe = { key: pipeKey, block: newPipeBlock };
      newBuildHistory[newBuildHistory.length - 1] = lastH;

      const cmd: UndoCommand = { kind: "hadamard-toggle", pipeKey, oldType: oldPipeType, newType: newPipeType,
        retyped: retyped.length > 0 ? retyped : undefined };
      return {
        blocks,
        hiddenFaces,
        buildHistory: newBuildHistory,
        undeterminedCubes: newUndetermined,
        history: [...s.history, cmd].slice(-MAX_HISTORY),
        future: [],
      };
    });
  },

  moveBuildCursor: (pos) =>
    set((state) => {
      if (state.mode !== "build") return state;
      const key = posKey(pos);
      const block = state.blocks.get(key);
      if (!block || isPipeType(block.type)) return state;
      return { buildCursor: pos };
    }),

  clearCameraSnap: () => set({ cameraSnapTarget: null }),
}));
