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
  PIPE_VARIANTS,
  VARIANT_AXIS_MAP,
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
  /** If the source cube was auto-determined during this step (was undetermined). */
  sourceDetermination?: {
    key: string;
    prevType: CubeType;
    prevUndeterminedInfo: UndeterminedCubeInfo;
  };
  /** If a determined source cube was retyped to accommodate a new pipe direction. */
  sourceRetype?: { key: string; prevType: CubeType };
  /** If the origin cube is undetermined after this step (first step only). */
  originUndetermined?: UndeterminedCubeInfo;
  /** If the destination cube is undetermined after this step. */
  destUndetermined?: UndeterminedCubeInfo;
  /** If an existing destination cube was re-typed to accommodate the new pipe. */
  destTypeChange?: { key: string; prevType: CubeType; newType: CubeType };
  /** If an existing undetermined destination became determined during this step. */
  destDetermination?: { key: string; prevUndeterminedInfo: UndeterminedCubeInfo };
};

type UndoCommand =
  | { kind: "add"; key: string; block: Block }
  | { kind: "remove"; key: string; block: Block }
  | { kind: "bulk-remove"; entries: Array<{ key: string; block: Block }> }
  | { kind: "clear"; savedBlocks: Map<string, Block>; savedHiddenFaces: Map<string, FaceMask>; savedUndetermined: Map<string, UndeterminedCubeInfo> }
  | { kind: "load"; savedBlocks: Map<string, Block>; savedHiddenFaces: Map<string, FaceMask>; savedUndetermined: Map<string, UndeterminedCubeInfo>;
      newBlocks: Map<string, Block>; newIndex: SpatialIndex; newHiddenFaces: Map<string, FaceMask> }
  | { kind: "build-step"; step: BuildStep }
  | { kind: "pipe-cycle"; pipeKey: string; oldType: PipeType; newType: PipeType;
      retyped?: Array<{ cubeKey: string; oldType: CubeType; newType: CubeType;
        oldUndetermined?: UndeterminedCubeInfo; newUndetermined?: UndeterminedCubeInfo }> }
  | { kind: "cube-cycle"; cubeKey: string; cubePos: Position3D;
      oldPlacedType: CubeType | "Y" | null; newPlacedType: CubeType | "Y";
      oldPipes?: Array<{ key: string; oldType: PipeType; newType: PipeType }>;
      oldUndetermined?: UndeterminedCubeInfo; newUndetermined?: UndeterminedCubeInfo }
  | { kind: "replace"; key: string; oldBlock: Block; newBlock: Block };

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
  hoveredReplace: boolean;
  selectedKeys: Set<string>;

  // Build mode state
  buildCursor: Position3D | null;
  buildHistory: BuildStep[];
  undeterminedCubes: Map<string, UndeterminedCubeInfo>;
  /** Camera snap target set by build actions, consumed by CameraBuildSnap component. */
  cameraSnapTarget: { azimuth: number | null; targetPos: Position3D } | null;
  /** Tracks the tqecAxis of the last build move (0/1/2) so camera only rotates on axis changes. */
  lastBuildAxis: number | null;

  setMode: (mode: Mode) => void;
  setCubeType: (cubeType: BlockType) => void;
  setPipeVariant: (variant: PipeVariant) => void;
  setHoveredGridPos: (pos: Position3D | null, blockType?: BlockType, invalid?: boolean, reason?: string, replace?: boolean) => void;
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
  selectBlocks: (keys: string[], additive: boolean) => void;

  // Build mode actions
  buildMove: (direction: BuildDirection) => boolean;
  undoBuildStep: () => void;
  cycleBlock: () => void;
  cyclePipe: () => void;
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
  hoveredReplace: false,
  selectedKeys: new Set(),

  // Build mode state
  buildCursor: null,
  buildHistory: [],
  undeterminedCubes: new Map(),
  cameraSnapTarget: null,
  lastBuildAxis: null,

  setMode: (mode) => {
    const prev = get();

    // Leaving build mode: keep undetermined cubes as-is (only committed when building away)
    if (prev.mode === "build" && mode !== "build") {
      set({
        mode,
        buildCursor: null,
        buildHistory: [],
        cameraSnapTarget: null,
        lastBuildAxis: null,
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
        if (cmd.kind === "replace" && !isPipeType(cmd.newBlock.type) && cmd.newBlock.type !== "Y") {
          cursorPos = cmd.newBlock.pos;
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
  setCubeType: (cubeType) => set({ cubeType, pipeVariant: null, hoveredGridPos: null, hoveredBlockType: null, hoveredInvalid: false, hoveredInvalidReason: null, hoveredReplace: false }),
  setPipeVariant: (variant) => set({ pipeVariant: variant, cubeType: PIPE_VARIANT_CANONICAL[variant], hoveredGridPos: null, hoveredBlockType: null, hoveredInvalid: false, hoveredInvalidReason: null, hoveredReplace: false }),
  setHoveredGridPos: (pos, blockType, invalid, reason, replace) => set((state) => {
    const bt = blockType ?? null;
    const inv = invalid ?? false;
    const rsn = reason ?? null;
    const rep = replace ?? false;
    // Skip no-op updates to avoid unnecessary re-renders
    if (
      state.hoveredGridPos?.x === pos?.x &&
      state.hoveredGridPos?.y === pos?.y &&
      state.hoveredGridPos?.z === pos?.z &&
      state.hoveredBlockType === bt &&
      state.hoveredInvalid === inv &&
      state.hoveredInvalidReason === rsn &&
      state.hoveredReplace === rep
    ) return state;
    return { hoveredGridPos: pos, hoveredBlockType: bt, hoveredInvalid: inv, hoveredInvalidReason: rsn, hoveredReplace: rep };
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

      const key = posKey(pos);
      const existing = state.blocks.get(key);

      // Validate position parity
      if (!isValidPos(pos, blockType)) return state;
      if (hasBlockOverlap(pos, blockType, state.blocks, state.spatialIndex, existing ? key : undefined)) return state;
      if (isPipeType(blockType) && hasPipeColorConflict(blockType, pos, state.blocks)) return state;
      if (!isPipeType(blockType) && blockType !== "Y" && hasCubeColorConflict(blockType as CubeType, pos, state.blocks)) return state;
      if (hasYCubePipeAxisConflict(blockType, pos, state.blocks)) return state;

      const block: Block = { pos, type: blockType };

      if (existing) {
        // Skip if same type — nothing to replace
        if (existing.type === blockType) return state;
        const removed = doRemove(state.blocks, state.spatialIndex, state.hiddenFaces, key, existing);
        const { blocks, hiddenFaces } = doAdd(removed.blocks, state.spatialIndex, removed.hiddenFaces, key, block);
        const cmd: UndoCommand = { kind: "replace", key, oldBlock: existing, newBlock: block };
        const newUndetermined = new Map(state.undeterminedCubes);
        newUndetermined.delete(key);
        return {
          blocks,
          hiddenFaces,
          history: [...state.history, cmd].slice(-MAX_HISTORY),
          future: [],
          undeterminedCubes: newUndetermined,
        };
      }

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
      const newUndetermined = new Map(state.undeterminedCubes);
      newUndetermined.delete(key);

      return {
        blocks,
        hiddenFaces,
        history: [...state.history, cmd].slice(-MAX_HISTORY),
        future: [],
        hoveredGridPos: null,
        undeterminedCubes: newUndetermined,
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
          undeterminedCubes: cmd.savedUndetermined,
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
        // Restore dest undetermined state
        if (step.destDetermination) {
          newUndetermined.set(step.destDetermination.key, {
            ...step.destDetermination.prevUndeterminedInfo,
            options: [...step.destDetermination.prevUndeterminedInfo.options],
          });
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
        // Revert source retype
        if (step.sourceRetype) {
          const sr = step.sourceRetype;
          const curSrc = blocks.get(sr.key);
          if (curSrc) ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, sr.key, curSrc));
          const reverted: Block = { pos: step.prevCursorPos, type: sr.prevType };
          ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, sr.key, reverted));
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

      if (cmd.kind === "pipe-cycle") {
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
        // Re-evaluate undetermined neighbors not in retyped list
        if (pipeBlock) {
          const base = cmd.oldType.replace("H", "");
          const openAxis = base.indexOf("O");
          const pc: [number, number, number] = [pipeBlock.pos.x, pipeBlock.pos.y, pipeBlock.pos.z];
          for (const offset of [-1, 2]) {
            const nc: [number, number, number] = [pc[0], pc[1], pc[2]];
            nc[openAxis] += offset;
            const nKey = posKey({ x: nc[0], y: nc[1], z: nc[2] });
            if (cmd.retyped?.some(r => r.cubeKey === nKey)) continue;
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
        }
        return { blocks, hiddenFaces, history: newHistory, future: [cmd, ...state.future].slice(0, MAX_HISTORY), undeterminedCubes: newUndetermined, hoveredGridPos: null };
      }

      if (cmd.kind === "cube-cycle") {
        let { blocks, hiddenFaces } = { blocks: state.blocks, hiddenFaces: state.hiddenFaces };
        const newUndetermined = new Map(state.undeterminedCubes);

        // Remove current cube
        const cubeBlock = blocks.get(cmd.cubeKey);
        if (cubeBlock) {
          ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, cmd.cubeKey, cubeBlock));
        }
        // Re-add old cube
        if (cmd.oldPlacedType) {
          ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, cmd.cubeKey, { pos: cmd.cubePos, type: cmd.oldPlacedType }));
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
        // Restore undetermined state
        if (cmd.oldUndetermined) newUndetermined.set(cmd.cubeKey, cmd.oldUndetermined);
        else newUndetermined.delete(cmd.cubeKey);
        return { blocks, hiddenFaces, history: newHistory, future: [cmd, ...state.future].slice(0, MAX_HISTORY), undeterminedCubes: newUndetermined, hoveredGridPos: null };
      }

      if (cmd.kind === "replace") {
        const removed = doRemove(state.blocks, state.spatialIndex, state.hiddenFaces, cmd.key, cmd.newBlock);
        const { blocks, hiddenFaces } = doAdd(removed.blocks, state.spatialIndex, removed.hiddenFaces, cmd.key, cmd.oldBlock);
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
        undeterminedCubes: cmd.savedUndetermined,
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
          undeterminedCubes: new Map(),
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
          const newSrcOptions = determineCubeOptions(step.prevCursorPos, blocks);
          const srcType = newSrcOptions.determined ? newSrcOptions.type : (newSrcOptions.options[0] ?? sd.prevType);
          ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, sd.key, { pos: step.prevCursorPos, type: srcType }));
          newUndetermined.delete(sd.key);
        }
        // Re-retype source
        if (step.sourceRetype) {
          const sr = step.sourceRetype;
          const curSrc = blocks.get(sr.key);
          if (curSrc) {
            ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, sr.key, curSrc));
            const newSrcOptions = determineCubeOptions(step.prevCursorPos, blocks);
            const candidates = newSrcOptions.determined ? [newSrcOptions.type] : newSrcOptions.options;
            const validForPipe = candidates.filter(ct => step.pipe && inferPipeType(ct, step.pipe.block.type.replace("H", "").indexOf("O") as 0 | 1 | 2) !== null);
            const srcType = validForPipe.length > 0 ? validForPipe[0] : sr.prevType;
            ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, sr.key, { pos: step.prevCursorPos, type: srcType }));
          }
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
        // Re-apply dest determination (existing dest became determined)
        if (step.destDetermination) {
          newUndetermined.delete(step.destDetermination.key);
        }
        // Re-place dest cube
        if (step.cube) {
          ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, step.cube.key, step.cube.block));
          if (step.destUndetermined) newUndetermined.set(step.cube.key, step.destUndetermined);
        }

        const newBuildHistory = [...state.buildHistory, step];

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

      if (cmd.kind === "pipe-cycle") {
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

        // Remove current cube
        const cubeBlock = blocks.get(cmd.cubeKey);
        if (cubeBlock) {
          ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, cmd.cubeKey, cubeBlock));
        }
        // Re-add new cube
        ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, cmd.cubeKey, { pos: cmd.cubePos, type: cmd.newPlacedType }));
        if (cmd.oldPipes) {
          for (const pu of cmd.oldPipes) {
            const pb = blocks.get(pu.key);
            if (pb) {
              ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, pu.key, pb));
              ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, pu.key, { pos: pb.pos, type: pu.newType }));
            }
          }
        }
        // Restore undetermined state
        if (cmd.newUndetermined) newUndetermined.set(cmd.cubeKey, cmd.newUndetermined);
        else newUndetermined.delete(cmd.cubeKey);
        return { blocks, hiddenFaces, history: [...state.history, cmd], future: newFuture, undeterminedCubes: newUndetermined, hoveredGridPos: null };
      }

      if (cmd.kind === "replace") {
        const removed = doRemove(state.blocks, state.spatialIndex, state.hiddenFaces, cmd.key, cmd.oldBlock);
        const { blocks, hiddenFaces } = doAdd(removed.blocks, state.spatialIndex, removed.hiddenFaces, cmd.key, cmd.newBlock);
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
        savedUndetermined: state.undeterminedCubes,
      };
      return {
        blocks: new Map(),
        spatialIndex: new Map(),
        hiddenFaces: new Map(),
        history: [...state.history, savedCmd],
        future: newFuture,
        hoveredGridPos: null,
        undeterminedCubes: new Map(),
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
      // Recompute undetermined state from loaded blocks
      const newUndetermined = new Map<string, UndeterminedCubeInfo>();
      for (const [key, block] of incoming) {
        if (isPipeType(block.type) || block.type === "Y") continue;
        const opts = determineCubeOptions(block.pos, incoming);
        if (!opts.determined && opts.options.length > 1) {
          const idx = Math.max(0, opts.options.indexOf(block.type as CubeType));
          newUndetermined.set(key, { options: [...opts.options], currentIndex: idx });
        }
      }
      const cmd: UndoCommand = {
        kind: "load",
        savedBlocks: state.blocks,
        savedHiddenFaces: state.hiddenFaces,
        savedUndetermined: state.undeterminedCubes,
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
        undeterminedCubes: newUndetermined,
      };
    }),

  clearAll: () =>
    set((state) => {
      if (state.blocks.size === 0) return state;
      const cmd: UndoCommand = {
        kind: "clear",
        savedBlocks: state.blocks,
        savedHiddenFaces: state.hiddenFaces,
        savedUndetermined: state.undeterminedCubes,
      };
      return {
        blocks: new Map(),
        spatialIndex: new Map(),
        hiddenFaces: new Map(),
        history: [...state.history, cmd].slice(-MAX_HISTORY),
        future: [],
        hoveredGridPos: null,
        selectedKeys: new Set<string>(),
        undeterminedCubes: new Map(),
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
      const newUndetermined = new Map(state.undeterminedCubes);
      for (const { key } of entries) newUndetermined.delete(key);
      return {
        blocks,
        hiddenFaces,
        history: [...state.history, cmd].slice(-MAX_HISTORY),
        future: [],
        selectedKeys: new Set<string>(),
        hoveredGridPos: null,
        undeterminedCubes: newUndetermined,
      };
    }),

  selectAll: () =>
    set((state) => {
      if (state.blocks.size === 0) return state;
      return { selectedKeys: new Set(state.blocks.keys()) };
    }),

  selectBlocks: (keys, additive) =>
    set((state) => {
      const next = additive ? new Set(state.selectedKeys) : new Set<string>();
      for (const key of keys) {
        if (state.blocks.has(key)) next.add(key);
      }
      return { selectedKeys: next };
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

    const reject = (reason?: string) => {
      if (reason) set({ hoveredInvalidReason: reason });
      return false;
    };

    // If pipe already exists, just move cursor to destination if it has a cube
    const existingPipe = state.blocks.get(pipeKey);
    if (existingPipe) {
      const existingDest = state.blocks.get(destKey);
      if (existingDest && !isPipeType(existingDest.type)) {
        const azimuth = cameraAzimuthForDirection(direction);
        set({
          buildCursor: destPos,
          cameraSnapTarget: { azimuth, targetPos: destPos },
          lastBuildAxis: direction.tqecAxis,
          hoveredInvalidReason: null,
        });
        return true;
      }
      return reject();
    }

    const srcBlock = state.blocks.get(srcKey);
    const isEmptyOrigin = !srcBlock;
    const isUndetermined = !isEmptyOrigin && state.undeterminedCubes.has(srcKey);

    // Determine source cube type
    let srcType: CubeType;
    let sourceDetermination: BuildStep["sourceDetermination"];
    let sourceRetype: BuildStep["sourceRetype"];

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
      if (validForDir.length === 0) return reject("Cannot build in this direction from undetermined cube");

      // Check if all valid options produce the same pipe type
      const pipeSet = new Set(validForDir.map(opt => inferPipeType(opt, direction.tqecAxis)));
      if (pipeSet.size > 1) return reject("Ambiguous pipe type — cycle with R first"); // Truly ambiguous — different pipe types, must cycle (R)

      // Prefer current type if it's valid for this direction
      const currentType = srcBlock!.type as CubeType;
      srcType = validForDir.includes(currentType) ? currentType : validForDir[0];
      // Always commit undetermined source
      sourceDetermination = {
        key: srcKey,
        prevType: currentType,
        prevUndeterminedInfo: { ...info, options: [...info.options] },
      };
    } else {
      srcType = srcBlock!.type as CubeType;

      // If current type can't pipe in this direction, try retyping via open axis
      if (!inferPipeType(srcType, direction.tqecAxis)) {
        const options = determineCubeOptions(cursor, state.blocks);
        const candidates = options.determined ? [options.type] : options.options;
        const validForDir = candidates.filter(ct => inferPipeType(ct, direction.tqecAxis) !== null);
        if (validForDir.length === 0) return reject("Cube colors don't match — cannot build in this direction");
        const pipeSet = new Set(validForDir.map(ct => inferPipeType(ct, direction.tqecAxis)));
        if (pipeSet.size > 1) return reject("Ambiguous pipe type — cycle with R first"); // Ambiguous — user must cycle (R)
        sourceRetype = { key: srcKey, prevType: srcType };
        srcType = validForDir[0];
      }
    }

    // Infer pipe type from source
    const pipeType = inferPipeType(srcType, direction.tqecAxis);
    if (!pipeType) return false;

    // Validate pipe position and overlap
    if (!isValidPos(pipePos, pipeType)) return reject("Invalid pipe position");
    if (hasBlockOverlap(pipePos, pipeType, state.blocks, state.spatialIndex)) return reject("Pipe would overlap existing blocks");

    // Y cube pipe axis conflict: Y cubes only work with Z-open pipes
    if (hasYCubePipeAxisConflict(pipeType, pipePos, state.blocks)) return reject("Y blocks only work with Z-open pipes");

    // Check if destination already has a cube
    const existingDest = state.blocks.get(destKey);
    let destTypeChange: BuildStep["destTypeChange"];
    if (existingDest) {
      if (existingDest.type === "Y" || isPipeType(existingDest.type)) return reject();
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
        return reject("Cube colors don't match the adjacent pipe"); // No valid type exists for dest with this pipe
      }
    } else {
      // Validate destination position and check for overlap with non-cube blocks
      if (!isValidPos(destPos, "XZZ")) return reject("Invalid destination position");
      if (hasBlockOverlap(destPos, "XZZ", state.blocks, state.spatialIndex)) return reject("Destination would overlap existing blocks");
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

      // Apply source retype (determined cube retyped for new pipe direction)
      if (sourceRetype) {
        const oldSrc = blocks.get(srcKey)!;
        ({ blocks, hiddenFaces } = doRemove(blocks, s.spatialIndex, hiddenFaces, srcKey, oldSrc));
        const newSrc: Block = { pos: cursor, type: srcType };
        ({ blocks, hiddenFaces } = doAdd(blocks, s.spatialIndex, hiddenFaces, srcKey, newSrc));
      }

      // Place pipe
      const pipeBlock: Block = { pos: pipePos, type: pipeType };
      ({ blocks, hiddenFaces } = doAdd(blocks, s.spatialIndex, hiddenFaces, pipeKey, pipeBlock));

      // Check if origin cube should be undetermined (placed before the pipe was known)
      let originUndetermined: UndeterminedCubeInfo | undefined;
      if (isEmptyOrigin) {
        const originOptions = determineCubeOptions(cursor, blocks);
        if (!originOptions.determined && originOptions.options.length > 1) {
          const idx = Math.max(0, originOptions.options.indexOf(srcType));
          originUndetermined = { options: [...originOptions.options], currentIndex: idx };
          newUndetermined.set(srcKey, originUndetermined);
        }
      }

      // Apply dest type change if existing cube needs re-typing
      if (destTypeChange) {
        const oldDest = blocks.get(destTypeChange.key)!;
        ({ blocks, hiddenFaces } = doRemove(blocks, s.spatialIndex, hiddenFaces, destTypeChange.key, oldDest));
        const newDest: Block = { pos: oldDest.pos, type: destTypeChange.newType };
        ({ blocks, hiddenFaces } = doAdd(blocks, s.spatialIndex, hiddenFaces, destTypeChange.key, newDest));
      }

      // Clean up undetermined state for existing destination that's now determined
      let destDetermination: BuildStep["destDetermination"];
      if (existingDest && newUndetermined.has(destKey)) {
        const destOptions = determineCubeOptions(destPos, blocks);
        if (destOptions.determined) {
          destDetermination = { key: destKey, prevUndeterminedInfo: newUndetermined.get(destKey)! };
          newUndetermined.delete(destKey);
        } else if (destOptions.options.length > 0) {
          const curType = (destTypeChange ? destTypeChange.newType : existingDest.type) as CubeType;
          const idx = Math.max(0, destOptions.options.indexOf(curType));
          newUndetermined.set(destKey, { options: [...destOptions.options], currentIndex: idx });
        }
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
        sourceRetype,
        originUndetermined,
        destUndetermined,
        destTypeChange,
        destDetermination,
      };

      const azimuth = cameraAzimuthForDirection(direction);

      return {
        blocks,
        hiddenFaces,
        buildCursor: destPos,
        buildHistory: [...s.buildHistory, step],
        undeterminedCubes: newUndetermined,
        cameraSnapTarget: { azimuth, targetPos: destPos },
        lastBuildAxis: direction.tqecAxis,
        history: [...s.history, { kind: "build-step" as const, step }].slice(-MAX_HISTORY),
        future: [],
        hoveredInvalidReason: null,
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

      // Revert source retype (determined cube back to previous type)
      if (step.sourceRetype) {
        const sr = step.sourceRetype;
        const curSrc = blocks.get(sr.key);
        if (curSrc) {
          ({ blocks, hiddenFaces } = doRemove(blocks, s.spatialIndex, hiddenFaces, sr.key, curSrc));
          const reverted: Block = { pos: step.prevCursorPos, type: sr.prevType };
          ({ blocks, hiddenFaces } = doAdd(blocks, s.spatialIndex, hiddenFaces, sr.key, reverted));
        }
        // Check if reverted source should now be undetermined (fewer pipe constraints)
        const srcOpts = determineCubeOptions(step.prevCursorPos, blocks);
        if (!srcOpts.determined && srcOpts.options.length > 1) {
          const idx = Math.max(0, srcOpts.options.indexOf(sr.prevType));
          newUndetermined.set(sr.key, { options: [...srcOpts.options], currentIndex: idx });
        } else {
          newUndetermined.delete(sr.key);
        }
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
          lastBuildAxis: null,
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
        lastBuildAxis: null,
        hoveredGridPos: null,
      };
    });
  },

  cycleBlock: () =>
    set((state) => {
      if (state.mode !== "build" || !state.buildCursor) return state;
      const cursor = state.buildCursor;
      const cursorKey = posKey(cursor);
      const coords: [number, number, number] = [cursor.x, cursor.y, cursor.z];

      // Count adjacent pipes and check if Y is valid (only Z-open pipes)
      let pipeCount = 0;
      let yValid = true;
      for (let axis = 0; axis < 3; axis++) {
        for (const pipeOffset of [1, -2]) {
          const nCoords: [number, number, number] = [coords[0], coords[1], coords[2]];
          nCoords[axis] += pipeOffset;
          const n = state.blocks.get(posKey({ x: nCoords[0], y: nCoords[1], z: nCoords[2] }));
          if (n && isPipeType(n.type)) {
            const openAxis = n.type.replace("H", "").indexOf("O");
            if (openAxis === axis) {
              pipeCount++;
              if (openAxis !== 2) yValid = false;
            }
          }
        }
      }
      if (pipeCount > 1) return state;

      // Determine valid cube type options
      const cubeOptions: (CubeType | "Y")[] = pipeCount === 0
        ? [...CUBE_TYPES]
        : (() => {
            const result = determineCubeOptions(cursor, state.blocks);
            return result.determined ? [result.type] : result.options;
          })();
      if (yValid) cubeOptions.push("Y");
      if (cubeOptions.length === 0) return state;

      // Cycle: undetermined → type1 → type2 → ... → Y (if valid) → undetermined
      // "undetermined" is represented by null in the cycle list.
      // When at undetermined, the block stays as-is but is in undeterminedCubes.
      const cycle: (CubeType | "Y" | null)[] = [null, ...cubeOptions];

      // Find current position in cycle
      const existingBlock = state.blocks.get(cursorKey);
      const isUndetermined = state.undeterminedCubes.has(cursorKey);
      const existingType = existingBlock && !isPipeType(existingBlock.type)
        ? existingBlock.type as CubeType | "Y" : null;

      let currentIdx: number;
      if (!existingBlock || isUndetermined) {
        // No block or undetermined → position 0 (undetermined)
        currentIdx = 0;
      } else {
        // Determined block → find in cycle
        currentIdx = cycle.indexOf(existingType);
        if (currentIdx < 0) currentIdx = 0;
      }

      const nextIdx = (currentIdx + 1) % cycle.length;
      const nextType = cycle[nextIdx];
      const isNextUndetermined = nextIdx === 0;

      let { blocks, hiddenFaces } = { blocks: state.blocks, hiddenFaces: state.hiddenFaces };
      const oldUndetermined = state.undeterminedCubes.get(cursorKey);
      const pipeUpdates: Array<{ key: string; oldType: PipeType; newType: PipeType }> = [];

      // Remove existing cube if present
      if (existingBlock) {
        ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, cursorKey, existingBlock));
      }

      // Determine what block to place
      let placeType: CubeType | "Y";
      if (isNextUndetermined) {
        // Cycling back to undetermined — place first valid CubeType as placeholder
        const firstCube = cubeOptions.find((t): t is CubeType => t !== "Y");
        if (!firstCube) return state; // only Y is valid, can't be undetermined
        placeType = firstCube;
      } else {
        placeType = nextType!;
      }

      const newBlock: Block = { pos: cursor, type: placeType };
      ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, cursorKey, newBlock));

      // Update adjacent pipes to match new cube type (skip for Y — Y doesn't change pipes)
      if (placeType !== "Y") {
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

            const newPipe = inferPipeType(placeType, axis as 0 | 1 | 2);
            if (!newPipe) {
              // Can't create valid pipe — reject cycle, revert
              ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, cursorKey, newBlock));
              if (existingBlock) {
                ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, cursorKey, existingBlock));
              }
              return state;
            }
            const newPipeType = hadamard ? (newPipe + "H") as PipeType : newPipe;
            if (newPipeType === neighbor.type) continue;

            // Validate against far-end cube
            const tmpBlocks = new Map(blocks);
            tmpBlocks.set(nKey, { pos: neighbor.pos, type: newPipeType });
            if (hasPipeColorConflict(newPipeType, neighbor.pos, tmpBlocks)) {
              // Conflict — reject cycle, revert
              ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, cursorKey, newBlock));
              if (existingBlock) {
                ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, cursorKey, existingBlock));
              }
              return state;
            }
            pipeUpdates.push({ key: nKey, oldType: neighbor.type as PipeType, newType: newPipeType });
          }
        }

        // Apply pipe mutations
        for (const pu of pipeUpdates) {
          const pipeBlock = blocks.get(pu.key)!;
          ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, pu.key, pipeBlock));
          ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, pu.key, { pos: pipeBlock.pos, type: pu.newType }));
        }
      }

      // Update undetermined state — recompute from current blocks (pipes may have changed)
      const newUndetermined = new Map(state.undeterminedCubes);
      let newUndeterminedInfo: UndeterminedCubeInfo | undefined;
      if (isNextUndetermined) {
        const freshOpts = determineCubeOptions(cursor, blocks);
        const freshCubeOpts = freshOpts.determined ? [] : freshOpts.options;
        if (freshCubeOpts.length > 1) {
          newUndeterminedInfo = { options: [...freshCubeOpts], currentIndex: 0 };
          newUndetermined.set(cursorKey, newUndeterminedInfo);
        } else {
          newUndetermined.delete(cursorKey);
        }
      } else {
        newUndetermined.delete(cursorKey);
      }

      const cmd: UndoCommand = {
        kind: "cube-cycle", cubeKey: cursorKey, cubePos: cursor,
        oldPlacedType: existingType, newPlacedType: placeType,
        oldPipes: pipeUpdates.length > 0 ? pipeUpdates : undefined,
        oldUndetermined, newUndetermined: newUndeterminedInfo,
      };
      return {
        blocks,
        hiddenFaces,
        undeterminedCubes: newUndetermined,
        history: [...state.history, cmd].slice(-MAX_HISTORY),
        future: [],
      };
    }),

  cyclePipe: () => {
    const state = get();
    if (state.mode !== "build" || !state.buildCursor) return;

    const cursor = state.buildCursor;
    const cursorCoords: [number, number, number] = [cursor.x, cursor.y, cursor.z];

    // Find adjacent pipes where either end (cursor or far cube) is undetermined
    const cursorKey = posKey(cursor);
    const cursorUndetermined = state.undeterminedCubes.has(cursorKey);
    const undeterminedPipes: { key: string; block: Block }[] = [];
    for (let axis = 0; axis < 3; axis++) {
      for (const offset of [1, -2]) {
        const pc: [number, number, number] = [cursorCoords[0], cursorCoords[1], cursorCoords[2]];
        pc[axis] += offset;
        const pk = posKey({ x: pc[0], y: pc[1], z: pc[2] });
        const pipe = state.blocks.get(pk);
        if (!pipe || !isPipeType(pipe.type)) continue;
        const pipeBase = (pipe.type as string).replace("H", "");
        if (pipeBase.indexOf("O") !== axis) continue;
        // Check if the far cube is undetermined
        const fc: [number, number, number] = [cursorCoords[0], cursorCoords[1], cursorCoords[2]];
        fc[axis] += offset === 1 ? 3 : -3;
        const farKey = posKey({ x: fc[0], y: fc[1], z: fc[2] });
        if (cursorUndetermined || state.undeterminedCubes.has(farKey)) {
          undeterminedPipes.push({ key: pk, block: pipe });
        }
      }
    }

    if (undeterminedPipes.length === 0) return;
    if (undeterminedPipes.length > 1) {
      set({ hoveredInvalidReason: "Multiple undetermined pipes — cannot cycle" });
      return;
    }

    const pipeKey = undeterminedPipes[0].key;
    const pipeBlock = undeterminedPipes[0].block;
    if (!isPipeType(pipeBlock.type)) return;

    const oldPipeType = pipeBlock.type as PipeType;
    const oldBase = oldPipeType.replace("H", "");
    const openAxis = oldBase.indexOf("O") as 0 | 1 | 2;
    const pipeCoords: [number, number, number] = [pipeBlock.pos.x, pipeBlock.pos.y, pipeBlock.pos.z];

    // Compute all candidate pipe types for this axis (one per toolbar variant)
    const allCandidates = PIPE_VARIANTS.map(v => VARIANT_AXIS_MAP[v][openAxis]);

    // Filter to valid candidates: both neighbor cubes must have valid options
    const validPipes: PipeType[] = [];
    for (const candidate of allCandidates) {
      const tmpBlocks = new Map(state.blocks);
      tmpBlocks.set(pipeKey, { pos: pipeBlock.pos, type: candidate });
      let valid = true;
      for (const offset of [-1, 2]) {
        const nCoords: [number, number, number] = [pipeCoords[0], pipeCoords[1], pipeCoords[2]];
        nCoords[openAxis] += offset;
        const nKey = posKey({ x: nCoords[0], y: nCoords[1], z: nCoords[2] });
        const neighbor = tmpBlocks.get(nKey);
        if (!neighbor || isPipeType(neighbor.type) || neighbor.type === "Y") continue;
        const options = determineCubeOptions(neighbor.pos, tmpBlocks);
        if (!options.determined && options.options.length === 0) { valid = false; break; }
      }
      if (valid) validPipes.push(candidate);
    }

    if (validPipes.length <= 1) return;

    // Cycle to the next valid pipe type
    const currentIdx = validPipes.indexOf(oldPipeType);
    const newPipeType = validPipes[(currentIdx + 1) % validPipes.length];
    if (newPipeType === oldPipeType) return;

    // --- Dry-run pass: validate all neighbors using a temp blocks map ---
    // No spatial index mutations happen here.
    const tmpBlocks = new Map(state.blocks);
    tmpBlocks.set(pipeKey, { pos: pipeBlock.pos, type: newPipeType });

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

      const cmd: UndoCommand = { kind: "pipe-cycle", pipeKey, oldType: oldPipeType, newType: newPipeType,
        retyped: retyped.length > 0 ? retyped : undefined };
      return {
        blocks,
        hiddenFaces,
        undeterminedCubes: newUndetermined,
        history: [...s.history, cmd].slice(-MAX_HISTORY),
        future: [],
      };
    });
  },

  moveBuildCursor: (pos) =>
    set((state) => {
      if (state.mode !== "build") return state;
      // Allow moving to any valid cube position (existing block or empty)
      const key = posKey(pos);
      const block = state.blocks.get(key);
      if (block && isPipeType(block.type)) return state; // can't land on a pipe
      return {
        buildCursor: pos,
        buildHistory: [],
        lastBuildAxis: null,
        cameraSnapTarget: { azimuth: null, targetPos: pos },
      };
    }),

  clearCameraSnap: () => set({ cameraSnapTarget: null }),
}));
