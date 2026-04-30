import { create } from "zustand";
import { useKeybindStore } from "./keybindStore";
import type { Flow } from "../utils/flows";
import type {
  Position3D, Block, BlockType, CubeType, PipeVariant, PipeType, SpatialIndex, FaceMask,
  BuildDirection, UndeterminedCubeInfo, ViewMode, IsoAxis, PortMeta, PortIO,
} from "../types";
import {
  posKey,
  getAllPortPositions,
  getOrderedPortPositions,
  defaultPortIO,
  hasBlockOverlap,
  hasCubeColorConflict,
  hasPipeColorConflict,
  hasYCubePipeAxisConflict,
  isPipeType,
  isValidBlockPos,
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
  determineCubeOptionsWithPipeRetype,
  computePipeRetypes,
  cameraAzimuthForDirection,
  canonicalCubeForPort,
  countAttachedPipes,
  getAttachedPipeKeys,
  CUBE_TYPES,
  PIPE_VARIANTS,
  VARIANT_AXIS_MAP,
  PIPE_TYPE_TO_VARIANT,
  toggleHadamard,
  swapPipeVariant,
  traversedPipeKey,
  flipBlockType,
  PLACEABLE_ORDER,
  currentPlaceableIndex,
} from "../types";
import { rotateBlockAroundAxis, type RotationAxis, type RotationOperation } from "../utils/blockRotation";
import {
  newGroupId as genNewGroupId,
  selectionGroupClassification,
  groupMembers as listGroupMembers,
  withoutGroupId,
} from "./groupSelectors";

// Toast helper: lazy-resolves validationStore via dynamic import to avoid the
// circular-import landmine (validationStore subscribes to blockStore at module
// init time, so a static import here would hoist that subscription before
// useBlockStore is defined and crash module load — surfaced by the test suite).
function reportGroupToast(msg: string): void {
  void import("./validationStore").then((m) => {
    m.useValidationStore.getState().reportEphemeralError(msg);
  });
}

/**
 * Walk `blocksAfter` (post-delete state), find any group that just dropped
 * below 2 members, and clear the lone survivor's `groupId`. Returns the
 * possibly-mutated blocks Map plus the list of survivors-restorable on
 * undo. Pure helper — called from any code path that deletes blocks
 * (deleteSelected, removeBlock single-and-cascade) so the ≥2-member
 * invariant holds across every delete path, not just the multi-select one.
 */
function applyAutoDissolve(
  blocksAfter: Map<string, Block>,
  deletedEntries: ReadonlyArray<{ key: string; block: Block }>,
): { blocks: Map<string, Block>; autoDissolvedFor: Array<{ survivorKey: string; priorGroupId: string }> } {
  const affectedGroupIds = new Set<string>();
  for (const e of deletedEntries) {
    if (e.block.groupId) affectedGroupIds.add(e.block.groupId);
  }
  const autoDissolvedFor: Array<{ survivorKey: string; priorGroupId: string }> = [];
  if (affectedGroupIds.size === 0) return { blocks: blocksAfter, autoDissolvedFor };

  const survivorsByGroup = new Map<string, string[]>();
  for (const [k, b] of blocksAfter) {
    if (b.groupId && affectedGroupIds.has(b.groupId)) {
      let list = survivorsByGroup.get(b.groupId);
      if (!list) {
        list = [];
        survivorsByGroup.set(b.groupId, list);
      }
      list.push(k);
    }
  }
  let result = blocksAfter;
  for (const gid of affectedGroupIds) {
    const survivors = survivorsByGroup.get(gid) ?? [];
    if (survivors.length === 0 || survivors.length >= 2) continue;
    if (result === blocksAfter) result = new Map(blocksAfter);
    for (const k of survivors) {
      const b = result.get(k);
      if (!b) continue;
      result.set(k, withoutGroupId(b));
      autoDissolvedFor.push({ survivorKey: k, priorGroupId: gid });
    }
  }
  return { blocks: result, autoDissolvedFor };
}

function dissolveToast(autoDissolvedFor: ReadonlyArray<{ priorGroupId: string }>): void {
  if (autoDissolvedFor.length === 0) return;
  const n = new Set(autoDissolvedFor.map((a) => a.priorGroupId)).size;
  reportGroupToast(
    n === 1
      ? "Group dissolved (only 1 member left)"
      : `${n} groups dissolved (only 1 member each)`,
  );
}

export type Mode = "edit" | "build";
export type ArmedTool = "pointer" | "cube" | "pipe" | "port" | "paste";

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
  /** Cursor destination after the step (set on redo). */
  destCursorPos: Position3D;
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
  /** Cubes inserted by syncPortsAndPromote because the new pipe pushed a port to ≥2 attachments. */
  autoPromoted?: Array<{ key: string; block: Block; wasUserPort: boolean }>;
};

type UndoCommand =
  | { kind: "add"; key: string; block: Block }
  | {
      kind: "remove";
      key: string;
      block: Block;
      /** Auto-dissolve survivors recorded so undo can restamp groupId. See bulk-remove. */
      autoDissolvedFor?: Array<{ survivorKey: string; priorGroupId: string }>;
    }
  | {
      kind: "bulk-remove";
      entries: Array<{ key: string; block: Block }>;
      portKeys?: string[];
      /**
       * Records groups that auto-dissolved as a side effect of this delete
       * (because their surviving member count fell below 2). Each entry is a
       * surviving block whose `groupId` was cleared during the delete; on
       * undo, restore that block's `groupId` after re-adding the deleted
       * blocks. See plan: Locked Edge-Case Behaviors → Block-lifecycle.
       */
      autoDissolvedFor?: Array<{ survivorKey: string; priorGroupId: string }>;
    }
  | { kind: "bulk-add"; entries: Array<{ key: string; block: Block }> }
  | { kind: "bulk-move"; entries: Array<{ oldKey: string; oldBlock: Block; newKey: string; newBlock: Block }> }
  | {
      /**
       * `groupSelected` (g-keystroke when ≥2 ungrouped selected) stamps a
       * shared `newGroupId` onto each member. `prevGroupId` is recorded for
       * audit symmetry though for v1 it is always `undefined` because the
       * keystroke truth-table only triggers createGroup on all-ungrouped
       * selections.
       */
      kind: "group-create";
      entries: Array<{ key: string; prevGroupId: string | undefined }>;
      newGroupId: string;
    }
  | {
      /**
       * `ungroupSelected` clears the `groupId` from every block where it
       * matches the target. Each entry preserves the prior `groupId` so undo
       * can restamp it.
       */
      kind: "ungroup";
      entries: Array<{ key: string; groupId: string }>;
    }
  | { kind: "clear"; savedBlocks: Map<string, Block>; savedHiddenFaces: Map<string, FaceMask>; savedUndetermined: Map<string, UndeterminedCubeInfo> }
  | { kind: "load"; savedBlocks: Map<string, Block>; savedHiddenFaces: Map<string, FaceMask>; savedUndetermined: Map<string, UndeterminedCubeInfo>;
      savedPortMeta: Map<string, PortMeta>; savedPortPositions: Set<string>;
      newBlocks: Map<string, Block>; newIndex: SpatialIndex; newHiddenFaces: Map<string, FaceMask>;
      newPortMeta: Map<string, PortMeta>; newPortPositions: Set<string> }
  | { kind: "build-step"; step: BuildStep }
  | { kind: "pipe-cycle"; pipeKey: string; oldType: PipeType; newType: PipeType;
      retyped?: Array<{ cubeKey: string; oldType: CubeType; newType: CubeType;
        oldUndetermined?: UndeterminedCubeInfo; newUndetermined?: UndeterminedCubeInfo }> }
  | { kind: "cube-cycle"; cubeKey: string; cubePos: Position3D;
      oldPlacedType: CubeType | "Y" | null; newPlacedType: CubeType | "Y" | null;
      oldPipes?: Array<{ key: string; oldType: PipeType; newType: PipeType }>;
      oldUndetermined?: UndeterminedCubeInfo; newUndetermined?: UndeterminedCubeInfo;
      undeterminedNeighbors?: Array<{ key: string; oldInfo?: UndeterminedCubeInfo; newInfo?: UndeterminedCubeInfo }> }
  | { kind: "replace"; key: string; oldBlock: Block; newBlock: Block }
  | { kind: "add-port"; key: string }
  | { kind: "remove-port"; key: string }
  | { kind: "bulk-replace"; entries: Array<{ key: string; oldBlock: Block; newBlock: Block }>;
      undeterminedChanges: Array<{ key: string; oldInfo?: UndeterminedCubeInfo; newInfo?: UndeterminedCubeInfo }> }
  | { kind: "rotate-selection";
      entries: Array<{ oldKey: string; oldBlock: Block; newKey: string; newBlock: Block }>;
      prevSelectedKeys: string[]; nextSelectedKeys: string[] }
  | { kind: "edit-type-cycle"; key: string; pos: Position3D;
      oldBlock: Block | null; newBlock: Block | null;
      oldPortMarker: boolean; newPortMarker: boolean;
      oldPipes?: Array<{ key: string; oldType: PipeType; newType: PipeType }>;
      prevSelectedKeys: string[]; nextSelectedKeys: string[];
      prevSelectedPortPositions: string[]; nextSelectedPortPositions: string[];
      undeterminedNeighbors?: Array<{ key: string; oldInfo?: UndeterminedCubeInfo; newInfo?: UndeterminedCubeInfo }> };

interface BlockStore {
  blocks: Map<string, Block>;
  spatialIndex: SpatialIndex;
  hiddenFaces: Map<string, FaceMask>;
  history: UndoCommand[];
  future: UndoCommand[];
  mode: Mode;
  /**
   * The currently armed tool in Drag / Drop mode. "pointer" behaves like the old
   * select mode (click selects, drag moves/marquees). A type tool ("cube" /
   * "pipe" / "port") behaves like the old place mode and uses the matching
   * `cubeType` / `pipeVariant` / port intent.
   */
  armedTool: ArmedTool;
  /**
   * True while the delete-modifier key (default X) is held. Short-circuits
   * hover/click handling to preview and perform single-click deletion in
   * Drag / Drop mode, regardless of the currently armed tool.
   */
  xHeld: boolean;
  cubeType: BlockType;
  pipeVariant: PipeVariant | null;
  /**
   * True between pointerdown on a placeable toolbar button and the
   * subsequent window-level pointerup. While true, the pointerup handler
   * places a block at the current hoveredGridPos (drag-from-palette gesture).
   */
  paletteDragging: boolean;
  /**
   * Transient warning message (e.g. "can't convert cube with ≥2 pipes").
   * Cleared automatically on any mode/tool change or after a few seconds.
   */
  portWarning: string | null;
  hoveredGridPos: Position3D | null;
  hoveredBlockType: BlockType | null;
  hoveredInvalid: boolean;
  hoveredInvalidReason: string | null;
  hoveredReplace: boolean;
  selectedKeys: Set<string>;
  /** Selected PORT positions (ports are transient, so keyed by posKey string rather than stored in `blocks`). */
  selectedPortPositions: Set<string>;
  /**
   * User-placed PORT markers at empty cube positions. These behave like ports at
   * open pipe endpoints (same ghost rendering, same auto-promote to cube when ≥2
   * pipes attach) but aren't implied by pipe geometry — they persist as empty-cell
   * markers until a cube is placed there or they're promoted.
   */
  portPositions: Set<string>;
  /** Pivot used by rotateSelected, cached across subsequent rotations of the same
   * selection so that 4×CCW returns to identity even when the selection bbox is
   * not cube-grid-aligned. Cleared whenever the selection itself changes. The
   * axis is stored alongside so that switching rotation axis recomputes the
   * pivot rather than reusing a stale one. */
  selectionPivot: { pos: Position3D; axis: RotationAxis } | null;

  /** Clipboard populated by `copySelection`. Entries are normalized so the
   * selection's bounding-box min corner sits at (0,0,0). In-memory only —
   * clears on refresh. `null` = nothing copied yet. */
  clipboard: Map<string, Block> | null;

  /**
   * Per-port metadata (label + input/output direction) used by the Stabilizer
   * Flows panel. Keyed by posKey. Entries are allocated lazily via
   * `ensurePortLabels` and survive across diagram edits (so a renamed port
   * keeps its name even if the user temporarily removes the connecting pipe).
   */
  portMeta: Map<string, PortMeta>;

  /** Whether the right-docked Stabilizer Flows panel is visible. */
  flowsPanelOpen: boolean;

  /** Whether the right-docked ZX-diagram panel is visible. */
  zxPanelOpen: boolean;

  /** Last-computed flows (with surface geometry), published by FlowsPanel. */
  flows: Flow[];
  /** Signature of the diagram when `flows` was last computed; used to detect stale data. */
  flowsSignature: string | null;
  /** Row selected in FlowsPanel (index into `flows`), shown in 3D when flowVizMode is on. */
  selectedFlowIndex: number | null;
  /** When on, dim blocks and render only the selected flow's correlation surfaces. */
  flowVizMode: boolean;

  // Drag-selection state (live during a drag of the current selection)
  isDraggingSelection: boolean;
  dragDelta: Position3D | null;
  dragValid: boolean;

  // Keyboard Build mode state
  buildCursor: Position3D | null;
  buildHistory: BuildStep[];
  undeterminedCubes: Map<string, UndeterminedCubeInfo>;
  /** Camera snap target set by build actions, consumed by CameraBuildSnap component. */
  cameraSnapTarget: { azimuth: number | null; targetPos: Position3D } | null;
  /** Tracks the tqecAxis of the last build move (0/1/2) so camera only rotates on axis changes. */
  lastBuildAxis: number | null;

  setMode: (mode: Mode) => void;
  setArmedTool: (tool: ArmedTool) => void;
  setXHeld: (held: boolean) => void;
  setCubeType: (cubeType: BlockType) => void;
  setPipeVariant: (variant: PipeVariant) => void;
  setPlacePort: (on: boolean) => void;
  /** Cycle the armed placeable by ±1 within PLACEABLE_ORDER (Drag / Drop mode only). */
  cycleArmedType: (dir: -1 | 1) => void;
  /**
   * In edit mode with a single cube/port/pipe selected and the pointer tool armed,
   * cycle the selected item through the toolbar options that remain valid at its
   * position. Selection is preserved (the selected-indicator follows the new type).
   * No-op if selection is empty, multi-select, or the only valid option is current.
   * If `target` is provided, jump directly to that option instead of cycling
   * (used by toolbar-button clicks). `dir` is ignored when `target` is provided.
   */
  cycleSelectedType: (
    dir: -1 | 1,
    target?:
      | { kind: "port" }
      | { kind: "cube"; type: CubeType | "Y" }
      | { kind: "pipe"; variant: PipeVariant },
  ) => void;
  setPaletteDragging: (on: boolean) => void;
  convertBlockToPort: (pos: Position3D) => void;
  clearPortWarning: () => void;
  addPortAt: (pos: Position3D) => void;
  removePortAt: (pos: Position3D) => void;
  setHoveredGridPos: (pos: Position3D | null, blockType?: BlockType, invalid?: boolean, reason?: string, replace?: boolean) => void;
  addBlock: (pos: Position3D) => void;
  removeBlock: (pos: Position3D) => void;
  undo: () => void;
  redo: () => void;
  loadBlocks: (
    blocks: Map<string, Block>,
    ports?: { portMeta: Map<string, PortMeta>; portPositions: Set<string> },
  ) => void;
  /**
   * Merge `blocks` into the current scene, auto-offset along +X so there's no
   * overlap, and leave every inserted block selected so the user can drag the
   * group into its final position. Switches to edit/pointer. Undo-safe.
   */
  insertBlocks: (blocks: Map<string, Block>) => void;
  /**
   * Snapshot currently-selected blocks into `clipboard`, normalized so the
   * bounding-box min corner sits at (0,0,0). No-op on empty selection — does
   * NOT clobber an existing clipboard.
   */
  copySelection: () => void;
  /**
   * Arm "placing paste" mode — a translucent ghost of the clipboard follows
   * the cursor and commits on click (or on a second invocation of this
   * action). Esc cancels. No-op if the clipboard is empty. If paste mode is
   * already armed, this commits at the current hover (so Cmd+V → Cmd+V
   * pastes in one spot without needing a click).
   */
  pasteClipboard: () => void;
  /**
   * Commit the clipboard into the scene at the currently hovered grid cell
   * (snapped to the cube-slot grid). If nothing is hovered, falls back to
   * the same +X auto-offset as `insertBlocks`. Leaves pasted blocks selected,
   * switches to edit/pointer. Undo-safe.
   */
  commitPaste: () => void;
  hydrateBlocks: (blocks: Map<string, Block>) => void;
  clearAll: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  selectBlock: (pos: Position3D, additive: boolean) => void;
  clearSelection: () => void;
  deleteSelected: () => void;
  flipSelected: () => void;
  rotateSelected: (axis: RotationAxis, operation: RotationOperation, pivotOverride?: Position3D | null) => { ok: true } | { ok: false; reason: string };
  selectAll: () => void;
  selectBlocks: (keys: string[], additive: boolean, portKeys?: string[]) => void;

  /**
   * Stamp a fresh `groupId` onto every block in `memberKeys`. Caller is
   * responsible for ensuring all members are currently ungrouped — the
   * `groupToggle` action's classifier enforces this. No-op if `memberKeys`
   * has fewer than 2 entries (a one-block "group" is meaningless).
   */
  groupSelected: (memberKeys: ReadonlySet<string>) => void;

  /**
   * Clear the `groupId` from every block where it matches `groupId`. No-op
   * if no blocks currently belong to this group.
   */
  ungroupSelected: (groupId: string) => void;

  /**
   * Toggle grouping based on the current selection's classification:
   * - all-ungrouped (≥2 members)         → groupSelected
   * - all-same-group / single-grouped    → ungroupSelected on that group
   * - empty / single-ungrouped           → toast (no-op)
   * - mixed-grouped-ungrouped            → toast (no-op)
   * - multi-group                        → toast (no-op)
   *
   * Returns a transient hint string consumed by the toast surface, or null
   * for the success cases. (Toast wiring goes through `validationStore`'s
   * ephemeral-error channel for v1.)
   */
  groupToggle: () => void;

  togglePortSelection: (pos: Position3D, additive: boolean) => void;
  clearPortSelection: () => void;
  /** Allocate fresh `P1`, `P2`, ... labels for any port position missing an entry. Idempotent. */
  ensurePortLabels: () => void;
  setPortLabel: (pos: Position3D, label: string) => void;
  setPortIO: (pos: Position3D, io: PortIO) => void;
  /**
   * Reorder ports by moving the port at `fromIndex` (in the current
   * user-ordered port list) to `toIndex`, then rewriting all ranks
   * 0..N-1 so the array indices match the stored ranks.
   */
  reorderPort: (fromIndex: number, toIndex: number) => void;
  setFlowsPanelOpen: (open: boolean) => void;
  toggleFlowsPanel: () => void;

  /** Publish computed flows (with surface geometry) for the 3D overlay to read. */
  setFlows: (flows: Flow[], signature: string) => void;
  setSelectedFlowIndex: (index: number | null) => void;
  setFlowVizMode: (on: boolean) => void;
  setZXPanelOpen: (open: boolean) => void;
  toggleZXPanel: () => void;
  setDragState: (s: { isDragging: boolean; delta: Position3D | null; valid: boolean }) => void;
  moveSelection: (delta: Position3D) => boolean;

  // Keyboard Build mode actions
  buildMove: (direction: BuildDirection) => boolean;
  undoBuildStep: () => void;
  cycleBlock: (target?: CubeType | "Y" | null) => void;
  cyclePipe: (target?: PipeVariant) => void;
  deleteAtBuildCursor: () => void;
  moveBuildCursor: (pos: Position3D) => void;
  clearCameraSnap: () => void;

  // Free build (disables color-matching validation)
  freeBuild: boolean;
  toggleFreeBuild: () => void;

  // View-chrome visibility toggles (keyboard shortcuts G / H).
  showGrid: boolean;
  showHints: boolean;
  toggleShowGrid: () => void;
  toggleShowHints: () => void;

  // Y-defect overlay: highlight X/Z transition edges (twists) in magenta.
  showYDefects: boolean;
  toggleShowYDefects: () => void;
  setShowYDefects: (on: boolean) => void;

  // Photo export — transient flag consumed by ScreenshotCapture inside <Canvas>.
  photoRequest: boolean;
  requestPhoto: () => void;
  clearPhotoRequest: () => void;

  // View mode (perspective vs. orthographic elevation along an axis)
  viewMode: ViewMode;
  /** Per-axis last-used slice so toggling between iso views remembers position. */
  lastIsoSlice: { x: number; y: number; z: number };
  setPerspView: () => void;
  setIsoView: (axis: IsoAxis) => void;
  stepSlice: (delta: number) => void;
}

// ---------------------------------------------------------------------------
// Helpers for incremental spatial-index + hidden-face updates
// ---------------------------------------------------------------------------

function charMatchCount(a: string, b: string): number {
  let n = 0;
  for (let i = 0; i < a.length && i < b.length; i++) if (a[i] === b[i]) n++;
  return n;
}

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

/**
 * For every open pipe endpoint with ≥2 attached pipes and no cube, insert the canonical cube.
 * Never auto-demotes. Call this only after pipe-mutating operations (add pipe, load, undo of a
 * pipe removal, etc.) — cube additions/removals do not change pipe attachment counts elsewhere,
 * and calling this after a cube deletion would undo the user's deletion at ports.
 */
function syncPortsAndPromote(
  blocks: Map<string, Block>,
  spatialIndex: SpatialIndex,
  hiddenFaces: Map<string, FaceMask>,
  portPositions?: Set<string>,
): {
  blocks: Map<string, Block>;
  hiddenFaces: Map<string, FaceMask>;
  addedEntries: Array<{ key: string; block: Block }>;
  promotedPortKeys: string[];
} {
  const addedEntries: Array<{ key: string; block: Block }> = [];
  const promotedPortKeys: string[] = [];
  let curBlocks = blocks;
  let curHidden = hiddenFaces;
  const seen = new Set<string>();

  const tryPromote = (pos: Position3D, key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    if (curBlocks.has(key)) return;
    const canonical = canonicalCubeForPort(pos, curBlocks);
    if (!canonical) return;
    // Auto-promoted blocks intentionally start ungrouped (`groupId` undefined).
    // Group membership requires explicit user action via the `g` keystroke.
    const newBlock: Block = { pos, type: canonical };
    const r = doAdd(curBlocks, spatialIndex, curHidden, key, newBlock);
    curBlocks = r.blocks;
    curHidden = r.hiddenFaces;
    addedEntries.push({ key, block: newBlock });
    if (portPositions?.has(key)) promotedPortKeys.push(key);
  };

  // Walk every pipe's two endpoints; promote any port that now has ≥2 attached pipes.
  for (const block of blocks.values()) {
    if (!isPipeType(block.type)) continue;
    const base = block.type.replace("H", "");
    const openAxis = base.indexOf("O");
    const coords: [number, number, number] = [block.pos.x, block.pos.y, block.pos.z];
    for (const offset of [-1, 2]) {
      const nCoords: [number, number, number] = [coords[0], coords[1], coords[2]];
      nCoords[openAxis] += offset;
      const pos: Position3D = { x: nCoords[0], y: nCoords[1], z: nCoords[2] };
      tryPromote(pos, posKey(pos));
    }
  }

  // Also promote any user-placed port markers whose position is now 2+-pipe-constrained.
  if (portPositions) {
    for (const key of portPositions) {
      if (seen.has(key)) continue;
      const parts = key.split(",").map(Number);
      const pos: Position3D = { x: parts[0], y: parts[1], z: parts[2] };
      tryPromote(pos, key);
    }
  }

  return { blocks: curBlocks, hiddenFaces: curHidden, addedEntries, promotedPortKeys };
}

/**
 * User-placed port markers that sit at the dangling endpoint of a pipe lose
 * their only reason to exist when that pipe is removed — an auto-inferred
 * port ghost made them visually redundant before, and now neither anchors
 * them. Collects the keys of such orphaned markers so callers can drop them
 * as part of the same undo step as the pipe removal.
 *
 * `blocksAfter` must reflect the state *after* the pipes are removed so we
 * don't falsely skip a port whose only remaining pipe just got deleted.
 */
function orphanedPortKeysFromRemovedPipes(
  removedPipes: Array<{ pos: Position3D; type: PipeType }>,
  blocksAfter: Map<string, Block>,
  portPositions: Set<string>,
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const pipe of removedPipes) {
    const base = pipe.type.replace("H", "");
    const openAxis = base.indexOf("O");
    const coords: [number, number, number] = [pipe.pos.x, pipe.pos.y, pipe.pos.z];
    for (const offset of [-1, 2]) {
      const n: [number, number, number] = [coords[0], coords[1], coords[2]];
      n[openAxis] += offset;
      const epPos: Position3D = { x: n[0], y: n[1], z: n[2] };
      const key = posKey(epPos);
      if (seen.has(key)) continue;
      seen.add(key);
      if (!portPositions.has(key)) continue;
      // Another cube occupies the slot — the port marker is still meaningful.
      if (blocksAfter.has(key)) continue;
      // Other pipes still anchor a port here.
      if (countAttachedPipes(epPos, blocksAfter) > 0) continue;
      result.push(key);
    }
  }
  return result;
}

/**
 * Translate `incoming` by `delta`, skip entries that collide with existing
 * blocks or land on invalid positions, and commit the surviving set as a
 * single `bulk-add` undo step. Returns the state patch callers can spread,
 * or `null` if nothing made it through (caller returns unchanged state).
 * Shared between `insertBlocks` (delta = +X auto-offset) and `pasteClipboard`
 * (delta = snapped hover, or +X fallback).
 */
function mergeBlocksWithDelta(
  state: BlockStore,
  incoming: Map<string, Block>,
  delta: Position3D,
): Partial<BlockStore> | null {
  // Two-phase paste (per Codex eng-review #4):
  // Phase 1 — translate every incoming entry, drop invalid positions and
  //           collisions; record surviving placements paired with their
  //           original `sourceGroupId`.
  // Phase 2 — for each source group with ≥2 surviving placements, mint a
  //           fresh nanoid and stamp it as `groupId` on those blocks.
  //           Source groups with fewer than 2 survivors leave their
  //           remaining placement ungrouped (matches the dissolve-<2 rule).
  const mergedBlocks = new Map(state.blocks);
  const placed: Array<{ key: string; pos: Position3D; type: BlockType; sourceGroupId: string | undefined }> = [];
  for (const b of incoming.values()) {
    const newPos: Position3D = {
      x: b.pos.x + delta.x,
      y: b.pos.y + delta.y,
      z: b.pos.z + delta.z,
    };
    if (!isValidPos(newPos, b.type)) continue;
    const newKey = posKey(newPos);
    if (mergedBlocks.has(newKey)) continue;
    placed.push({ key: newKey, pos: newPos, type: b.type, sourceGroupId: b.groupId });
    // Reserve the slot so subsequent incoming entries can't collide on the same key.
    mergedBlocks.set(newKey, { pos: newPos, type: b.type });
  }
  if (placed.length === 0) return null;

  // Tally survivors per source group; allocate one fresh nanoid per group
  // that has ≥2 survivors.
  const groupSurvivorCount = new Map<string, number>();
  for (const p of placed) {
    if (!p.sourceGroupId) continue;
    groupSurvivorCount.set(p.sourceGroupId, (groupSurvivorCount.get(p.sourceGroupId) ?? 0) + 1);
  }
  const sourceGroupToNew = new Map<string, string>();
  for (const [src, count] of groupSurvivorCount) {
    if (count >= 2) sourceGroupToNew.set(src, genNewGroupId());
  }

  const entries: Array<{ key: string; block: Block }> = [];
  for (const p of placed) {
    const remappedGid = p.sourceGroupId ? sourceGroupToNew.get(p.sourceGroupId) : undefined;
    const newBlock: Block = remappedGid
      ? { pos: p.pos, type: p.type, groupId: remappedGid }
      : { pos: p.pos, type: p.type };
    mergedBlocks.set(p.key, newBlock);
    entries.push({ key: p.key, block: newBlock });
  }
  if (entries.length === 0) return null;

  const { spatialIndex, hiddenFaces, undeterminedCubes } = computeDerivedFromBlocks(mergedBlocks);
  const cmd: UndoCommand = { kind: "bulk-add", entries };
  return {
    blocks: mergedBlocks,
    spatialIndex,
    hiddenFaces,
    undeterminedCubes,
    history: [...state.history, cmd].slice(-MAX_HISTORY),
    future: [],
    hoveredGridPos: null,
    selectedKeys: new Set(entries.map((e) => e.key)),
    selectedPortPositions: new Set<string>(),
    mode: "edit",
    armedTool: "pointer",
  };
}

/**
 * Reducer for actually committing the clipboard. Extracted so it can run from
 * both `commitPaste` (click / second Cmd+V) and a double Cmd+V inside
 * `pasteClipboard` while paste mode is armed.
 */
function commitPasteReducer(state: BlockStore): Partial<BlockStore> | BlockStore {
  const clip = state.clipboard;
  if (!clip || clip.size === 0) return state;
  const hover = state.hoveredGridPos;
  if (hover) {
    const delta: Position3D = {
      x: Math.floor(hover.x / 3) * 3,
      y: Math.floor(hover.y / 3) * 3,
      z: Math.floor(hover.z / 3) * 3,
    };
    return mergeBlocksWithDelta(state, clip, delta) ?? state;
  }
  let delta: Position3D = { x: 0, y: 0, z: 0 };
  if (state.blocks.size > 0) {
    let existingMaxX = -Infinity;
    for (const b of state.blocks.values()) {
      if (b.pos.x > existingMaxX) existingMaxX = b.pos.x;
    }
    let incomingMinX = Infinity;
    for (const b of clip.values()) {
      if (b.pos.x < incomingMinX) incomingMinX = b.pos.x;
    }
    const raw = existingMaxX + 3 - incomingMinX;
    delta = { x: Math.ceil(raw / 3) * 3, y: 0, z: 0 };
  }
  return mergeBlocksWithDelta(state, clip, delta) ?? state;
}

function computeDerivedFromBlocks(blocks: Map<string, Block>): {
  spatialIndex: SpatialIndex;
  hiddenFaces: Map<string, FaceMask>;
  undeterminedCubes: Map<string, UndeterminedCubeInfo>;
} {
  const spatialIndex = buildSpatialIndex(blocks);
  const hiddenFaces: Map<string, FaceMask> = new Map();
  for (const [key, block] of blocks) {
    const mask = getHiddenFaceMaskForPos(block.pos, block.type, blocks, spatialIndex);
    if (mask !== 0) hiddenFaces.set(key, mask);
  }
  const undeterminedCubes = new Map<string, UndeterminedCubeInfo>();
  for (const [key, block] of blocks) {
    if (isPipeType(block.type) || block.type === "Y") continue;
    const opts = determineCubeOptions(block.pos, blocks);
    if (!opts.determined && opts.options.length > 1) {
      const idx = Math.max(0, opts.options.indexOf(block.type as CubeType));
      undeterminedCubes.set(key, { options: [...opts.options], currentIndex: idx });
    }
  }
  return { spatialIndex, hiddenFaces, undeterminedCubes };
}

function readShowYDefects(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem("piperDraw.showYDefects") === "1";
  } catch {
    return false;
  }
}

export const useBlockStore = create<BlockStore>((set, get) => ({
  blocks: new Map(),
  spatialIndex: new Map(),
  hiddenFaces: new Map(),
  history: [],
  future: [],
  mode: "edit",
  armedTool: "port",
  xHeld: false,
  cubeType: "XZZ",
  pipeVariant: null,
  paletteDragging: false,
  portWarning: null,
  hoveredGridPos: null,
  hoveredBlockType: null,
  hoveredInvalid: false,
  hoveredInvalidReason: null,
  hoveredReplace: false,
  selectedKeys: new Set(),
  selectedPortPositions: new Set(),
  portPositions: new Set(),
  portMeta: new Map(),
  flowsPanelOpen: false,
  zxPanelOpen: false,
  flows: [],
  flowsSignature: null,
  selectedFlowIndex: null,
  flowVizMode: false,
  selectionPivot: null,
  clipboard: null,

  isDraggingSelection: false,
  dragDelta: null,
  dragValid: true,

  // Keyboard Build mode state
  buildCursor: null,
  buildHistory: [],
  undeterminedCubes: new Map(),
  cameraSnapTarget: null,
  lastBuildAxis: null,

  freeBuild: false,
  toggleFreeBuild: () => set((s) => ({ freeBuild: !s.freeBuild })),

  showGrid: true,
  showHints: true,
  toggleShowGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  toggleShowHints: () => set((s) => ({ showHints: !s.showHints })),

  // Hydrate from localStorage at store creation so the toolbar paints the
  // correct state on first render — avoids a one-frame flicker on reload.
  showYDefects: readShowYDefects(),
  toggleShowYDefects: () => set((s) => ({ showYDefects: !s.showYDefects })),
  setShowYDefects: (on) => set({ showYDefects: on }),

  photoRequest: false,
  requestPhoto: () => set({ photoRequest: true }),
  clearPhotoRequest: () => set({ photoRequest: false }),

  viewMode: { kind: "persp" },
  lastIsoSlice: { x: 0, y: 0, z: 0 },
  setPerspView: () =>
    set((s) => (s.viewMode.kind === "persp" ? s : { viewMode: { kind: "persp" } })),
  setIsoView: (axis) =>
    set((s) => ({
      viewMode: { kind: "iso", axis, slice: s.lastIsoSlice[axis] },
    })),
  stepSlice: (delta) =>
    set((s) => {
      if (s.viewMode.kind !== "iso") return s;
      const slice = s.viewMode.slice + delta;
      return {
        viewMode: { ...s.viewMode, slice },
        lastIsoSlice: { ...s.lastIsoSlice, [s.viewMode.axis]: slice },
      };
    }),

  setMode: (mode) => {
    const prev = get();

    // Leaving Keyboard Build mode: keep undetermined cubes as-is (only committed when building away)
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
        selectedPortPositions: new Set<string>(),
        xHeld: false,
        selectionPivot: null,
      });
      return;
    }

    // Entering Keyboard Build mode: place cursor on last-placed cube or origin
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

      // In iso mode, seed a camera snap so the slice follows the cursor when
      // it lands off-slab; in perspective we don't auto-animate on entry.
      const cameraSnapTarget =
        prev.viewMode.kind === "iso" ? { azimuth: null, targetPos: cursorPos } : null;

      set({
        mode,
        buildCursor: cursorPos,
        buildHistory: [],
        cameraSnapTarget,
        hoveredGridPos: null,
        hoveredBlockType: null,
        hoveredInvalid: false,
        hoveredInvalidReason: null,
        selectedKeys: new Set<string>(),
        selectedPortPositions: new Set<string>(),
        xHeld: false,
        selectionPivot: null,
      });
      return;
    }

    set({
      mode,
      hoveredGridPos: null,
      hoveredBlockType: null,
      hoveredInvalid: false,
      hoveredInvalidReason: null,
      isDraggingSelection: false,
      dragDelta: null,
      dragValid: true,
      xHeld: false,
      selectionPivot: null,
    });
  },
  setArmedTool: (tool) => set({
    armedTool: tool,
    portWarning: null,
    hoveredGridPos: null,
    hoveredBlockType: null,
    hoveredInvalid: false,
    hoveredInvalidReason: null,
    hoveredReplace: false,
    ...(tool !== "pipe" ? { pipeVariant: null } : {}),
    ...(tool !== "pointer" ? { selectedKeys: new Set<string>(), selectedPortPositions: new Set<string>(), selectionPivot: null } : {}),
  }),
  setXHeld: (held) => set({ xHeld: held, hoveredGridPos: null, hoveredBlockType: null, hoveredInvalid: false, hoveredInvalidReason: null, hoveredReplace: false }),
  setCubeType: (cubeType) => set({ cubeType, armedTool: "cube", pipeVariant: null, portWarning: null, hoveredGridPos: null, hoveredBlockType: null, hoveredInvalid: false, hoveredInvalidReason: null, hoveredReplace: false, selectedKeys: new Set<string>(), selectedPortPositions: new Set<string>(), selectionPivot: null }),
  setPipeVariant: (variant) => set({ pipeVariant: variant, cubeType: PIPE_VARIANT_CANONICAL[variant], armedTool: "pipe", portWarning: null, hoveredGridPos: null, hoveredBlockType: null, hoveredInvalid: false, hoveredInvalidReason: null, hoveredReplace: false, selectedKeys: new Set<string>(), selectedPortPositions: new Set<string>(), selectionPivot: null }),
  setPlacePort: (on) => set({ armedTool: on ? "port" : "pointer", pipeVariant: null, portWarning: null, hoveredGridPos: null, hoveredBlockType: null, hoveredInvalid: false, hoveredInvalidReason: null, hoveredReplace: false, ...(on ? { selectedKeys: new Set<string>(), selectedPortPositions: new Set<string>(), selectionPivot: null } : {}) }),
  cycleArmedType: (dir) => {
    const s = get();
    if (s.mode !== "edit") return;
    const cur = currentPlaceableIndex(s.armedTool, s.cubeType, s.pipeVariant);
    const N = PLACEABLE_ORDER.length;
    const next = cur === -1
      ? (dir === 1 ? 0 : N - 1)
      : (((cur + dir) % N) + N) % N;
    const target = PLACEABLE_ORDER[next];
    if (target.kind === "port") s.setPlacePort(true);
    else if (target.kind === "cube") s.setCubeType(target.cubeType);
    else s.setPipeVariant(target.variant);
  },
  cycleSelectedType: (dir, target) => {
    const state = get();
    if (state.mode !== "edit" || state.armedTool !== "pointer") return;

    // Single-pipe branch — cycle pipe variants among those that keep neighbour
    // cubes valid, matching the set the toolbar highlights for a selected pipe.
    if (state.selectedKeys.size === 1 && state.selectedPortPositions.size === 0) {
      const pipeKey = state.selectedKeys.values().next().value as string;
      const pipeBlock = state.blocks.get(pipeKey);
      if (pipeBlock && isPipeType(pipeBlock.type)) {
        set((s) => {
          const oldType = pipeBlock.type as PipeType;
          const base = oldType.replace("H", "");
          const openAxis = base.indexOf("O") as 0 | 1 | 2;
          const pipeCoords: [number, number, number] = [pipeBlock.pos.x, pipeBlock.pos.y, pipeBlock.pos.z];
          const currentVariant = PIPE_TYPE_TO_VARIANT[oldType];

          const validVariants: PipeVariant[] = [];
          if (s.freeBuild) {
            for (const v of PIPE_VARIANTS) validVariants.push(v);
          } else {
            for (const v of PIPE_VARIANTS) {
              const candidate = VARIANT_AXIS_MAP[v][openAxis];
              const tmp = new Map(s.blocks);
              tmp.set(pipeKey, { pos: pipeBlock.pos, type: candidate });
              let ok = true;
              for (const offset of [-1, 2]) {
                const nc: [number, number, number] = [pipeCoords[0], pipeCoords[1], pipeCoords[2]];
                nc[openAxis] += offset;
                const nKey = posKey({ x: nc[0], y: nc[1], z: nc[2] });
                const neighbor = tmp.get(nKey);
                if (!neighbor || isPipeType(neighbor.type) || neighbor.type === "Y") continue;
                const opts = determineCubeOptions(neighbor.pos, tmp);
                const currentType = neighbor.type as CubeType;
                if (opts.determined) {
                  if (opts.type !== currentType) { ok = false; break; }
                } else if (!opts.options.includes(currentType)) {
                  ok = false; break;
                }
              }
              if (ok) validVariants.push(v);
            }
          }

          const cycle: PipeVariant[] = [];
          for (const v of PIPE_VARIANTS) {
            if (v === currentVariant || validVariants.includes(v)) cycle.push(v);
          }
          if (cycle.length <= 1) return s;

          let nextVariant: PipeVariant;
          if (target !== undefined) {
            if (target.kind !== "pipe" || !cycle.includes(target.variant)) return s;
            nextVariant = target.variant;
          } else {
            const curIdx = cycle.indexOf(currentVariant);
            if (curIdx === -1) return s;
            const nextIdx = (((curIdx + dir) % cycle.length) + cycle.length) % cycle.length;
            nextVariant = cycle[nextIdx];
          }
          if (nextVariant === currentVariant) return s;

          const newType = VARIANT_AXIS_MAP[nextVariant][openAxis];
          let { blocks, hiddenFaces } = { blocks: s.blocks, hiddenFaces: s.hiddenFaces };
          ({ blocks, hiddenFaces } = doRemove(blocks, s.spatialIndex, hiddenFaces, pipeKey, pipeBlock));
          ({ blocks, hiddenFaces } = doAdd(blocks, s.spatialIndex, hiddenFaces, pipeKey, { ...pipeBlock, type: newType }));

          const cmd: UndoCommand = { kind: "pipe-cycle", pipeKey, oldType, newType };
          return {
            blocks,
            hiddenFaces,
            history: [...s.history, cmd].slice(-MAX_HISTORY),
            future: [],
          };
        });
        return;
      }
    }

    // Cube-slot branch — single selected cube/Y OR single selected port. Cycle
    // through the toolbar's enabled set (port slot if pipeCount<2, cube types
    // valid per determineCubeOptions, plus Y if all attached pipes are Z-open).
    const onePort = state.selectedKeys.size === 0 && state.selectedPortPositions.size === 1;
    const oneCube = state.selectedKeys.size === 1 && state.selectedPortPositions.size === 0
      && (() => {
        const k = state.selectedKeys.values().next().value as string;
        const b = state.blocks.get(k);
        return !!b && !isPipeType(b.type);
      })();
    if (!onePort && !oneCube) return;

    set((s) => {
      let key: string;
      let pos: Position3D;
      let currentKind: "PORT" | CubeType | "Y";
      let existingBlock: Block | null;
      if (oneCube) {
        key = s.selectedKeys.values().next().value as string;
        const b = s.blocks.get(key);
        if (!b || isPipeType(b.type)) return s;
        existingBlock = b;
        pos = b.pos;
        currentKind = b.type as CubeType | "Y";
      } else {
        key = s.selectedPortPositions.values().next().value as string;
        const [x, y, z] = key.split(",").map(Number);
        pos = { x, y, z };
        existingBlock = null;
        currentKind = "PORT";
      }

      const coords: [number, number, number] = [pos.x, pos.y, pos.z];
      let pipeCount = 0;
      for (let axis = 0; axis < 3; axis++) {
        for (const offset of [1, -2]) {
          const nc: [number, number, number] = [coords[0], coords[1], coords[2]];
          nc[axis] += offset;
          const n = s.blocks.get(posKey({ x: nc[0], y: nc[1], z: nc[2] }));
          if (n && isPipeType(n.type)) {
            const openAxis = n.type.replace("H", "").indexOf("O");
            if (openAxis === axis) pipeCount++;
          }
        }
      }
      let cubeOpts: Set<CubeType | "Y">;
      let portAllowed: boolean;
      if (s.freeBuild) {
        cubeOpts = new Set<CubeType | "Y">([...CUBE_TYPES, "Y"]);
        portAllowed = true;
      } else {
        cubeOpts = new Set<CubeType | "Y">(determineCubeOptionsWithPipeRetype(pos, s.blocks));
        // Y is a leaf: only valid with at most one attached (Z-open) pipe.
        if (pipeCount <= 1 && !hasYCubePipeAxisConflict("Y", pos, s.blocks)) cubeOpts.add("Y");
        portAllowed = pipeCount < 2;
      }

      type Opt = { kind: "port" } | { kind: "cube"; type: CubeType | "Y" };
      const cycle: Opt[] = [];
      if (portAllowed || currentKind === "PORT") cycle.push({ kind: "port" });
      for (const ct of CUBE_TYPES) {
        if (cubeOpts.has(ct) || ct === currentKind) cycle.push({ kind: "cube", type: ct });
      }
      if (cubeOpts.has("Y") || currentKind === "Y") cycle.push({ kind: "cube", type: "Y" });
      if (cycle.length <= 1) return s;

      let nextOpt: Opt;
      if (target !== undefined) {
        if (target.kind === "pipe") return s;
        const found = cycle.find((o) =>
          target.kind === "port" ? o.kind === "port" : (o.kind === "cube" && o.type === target.type),
        );
        if (!found) return s;
        nextOpt = found;
      } else {
        const curIdx = cycle.findIndex((o) =>
          currentKind === "PORT" ? o.kind === "port" : (o.kind === "cube" && o.type === currentKind)
        );
        if (curIdx === -1) return s;
        const nextIdx = (((curIdx + dir) % cycle.length) + cycle.length) % cycle.length;
        nextOpt = cycle[nextIdx];
      }
      // No-op if target equals current (toolbar click on the already-placed type).
      if (nextOpt.kind === "port" && currentKind === "PORT") return s;
      if (nextOpt.kind === "cube" && nextOpt.type === currentKind) return s;

      let { blocks, hiddenFaces } = { blocks: s.blocks, hiddenFaces: s.hiddenFaces };
      const oldPortMarker = s.portPositions.has(key);
      let newBlock: Block | null;
      let newPortMarker: boolean;

      if (nextOpt.kind === "port") {
        if (existingBlock) {
          ({ blocks, hiddenFaces } = doRemove(blocks, s.spatialIndex, hiddenFaces, key, existingBlock));
        }
        newBlock = null;
        // Leave an explicit port marker so the user's intent persists even if
        // adjacent pipes are later removed (mirrors convertBlockToPort).
        newPortMarker = true;
      } else {
        if (existingBlock) {
          ({ blocks, hiddenFaces } = doRemove(blocks, s.spatialIndex, hiddenFaces, key, existingBlock));
        }
        // Preserve `groupId` (and any future Block metadata) when cycling type.
        newBlock = existingBlock
          ? { ...existingBlock, type: nextOpt.type }
          : { pos, type: nextOpt.type };
        ({ blocks, hiddenFaces } = doAdd(blocks, s.spatialIndex, hiddenFaces, key, newBlock));
        // Placing a cube clears any explicit port marker at this position
        // (mirrors addBlock's behaviour when a cube lands on a user-placed port).
        newPortMarker = false;
      }

      // Retype adjacent pipes when target is a real cube (not Y / port) and not freeBuild.
      // The wider gate already vetted feasibility; computePipeRetypes returns the actual
      // updates (preserving Hadamard) or null on far-end conflict.
      const pipeUpdates: Array<{ key: string; oldType: PipeType; newType: PipeType }> = [];
      if (newBlock && nextOpt.kind === "cube" && nextOpt.type !== "Y" && !s.freeBuild) {
        const retypes = computePipeRetypes(blocks, pos, nextOpt.type as CubeType);
        if (retypes === null) {
          // Defense-in-depth: revert spatial-index mutations from the just-applied
          // cube placement and bail. (Shouldn't fire — wider gate vetted feasibility.)
          doRemove(blocks, s.spatialIndex, hiddenFaces, key, newBlock);
          if (existingBlock) {
            doAdd(blocks, s.spatialIndex, hiddenFaces, key, existingBlock);
          }
          return s;
        }
        for (const pu of retypes) {
          const pipeBlock = blocks.get(pu.key)!;
          ({ blocks, hiddenFaces } = doRemove(blocks, s.spatialIndex, hiddenFaces, pu.key, pipeBlock));
          ({ blocks, hiddenFaces } = doAdd(blocks, s.spatialIndex, hiddenFaces, pu.key, { pos: pipeBlock.pos, type: pu.newType }));
          pipeUpdates.push(pu);
        }
      }

      // Refresh undeterminedCubes for far-end neighbours of retyped pipes (mirrors
      // the pipe-cycle pattern at line ~1519 and the cube-cycle path in cycleBlock).
      const newUndetermined = new Map(s.undeterminedCubes);
      const undeterminedNeighbors: Array<{ key: string; oldInfo?: UndeterminedCubeInfo; newInfo?: UndeterminedCubeInfo }> = [];
      const seenNeighbors = new Set<string>();
      for (const pu of pipeUpdates) {
        const pipe = blocks.get(pu.key);
        if (!pipe || !isPipeType(pipe.type)) continue;
        const base = pipe.type.replace("H", "");
        const openAxis = base.indexOf("O");
        const pc: [number, number, number] = [pipe.pos.x, pipe.pos.y, pipe.pos.z];
        for (const endOffset of [-1, 2]) {
          const nc: [number, number, number] = [pc[0], pc[1], pc[2]];
          nc[openAxis] += endOffset;
          const nKey = posKey({ x: nc[0], y: nc[1], z: nc[2] });
          if (nKey === key) continue;
          if (seenNeighbors.has(nKey)) continue;
          seenNeighbors.add(nKey);
          const neighborBlock = blocks.get(nKey);
          if (!neighborBlock || isPipeType(neighborBlock.type) || neighborBlock.type === "Y") continue;
          const oldInfo = s.undeterminedCubes.get(nKey);
          const opts = determineCubeOptions(neighborBlock.pos, blocks);
          let newInfo: UndeterminedCubeInfo | undefined;
          if (opts.determined) {
            newInfo = undefined;
          } else if (opts.options.length > 0) {
            const idx = Math.max(0, opts.options.indexOf(neighborBlock.type as CubeType));
            newInfo = { options: [...opts.options], currentIndex: idx };
          } else {
            newInfo = oldInfo;
          }
          const sameInfo =
            (!oldInfo && !newInfo) ||
            (!!oldInfo && !!newInfo &&
              oldInfo.options.join(",") === newInfo.options.join(",") &&
              oldInfo.currentIndex === newInfo.currentIndex);
          if (sameInfo) continue;
          undeterminedNeighbors.push({ key: nKey, oldInfo, newInfo });
          if (newInfo) newUndetermined.set(nKey, newInfo);
          else newUndetermined.delete(nKey);
        }
      }

      const newPorts = new Set(s.portPositions);
      if (newPortMarker) newPorts.add(key); else newPorts.delete(key);

      const newSelectedKeys = new Set(s.selectedKeys);
      const newSelectedPorts = new Set(s.selectedPortPositions);
      if (newBlock) {
        newSelectedKeys.add(key);
        newSelectedPorts.delete(key);
      } else {
        newSelectedKeys.delete(key);
        newSelectedPorts.add(key);
      }

      const cmd: UndoCommand = {
        kind: "edit-type-cycle", key, pos,
        oldBlock: existingBlock, newBlock,
        oldPortMarker, newPortMarker,
        oldPipes: pipeUpdates.length > 0 ? pipeUpdates : undefined,
        prevSelectedKeys: [...s.selectedKeys],
        nextSelectedKeys: [...newSelectedKeys],
        prevSelectedPortPositions: [...s.selectedPortPositions],
        nextSelectedPortPositions: [...newSelectedPorts],
        undeterminedNeighbors: undeterminedNeighbors.length > 0 ? undeterminedNeighbors : undefined,
      };
      return {
        blocks,
        hiddenFaces,
        portPositions: newPorts,
        selectedKeys: newSelectedKeys,
        selectedPortPositions: newSelectedPorts,
        undeterminedCubes: newUndetermined,
        history: [...s.history, cmd].slice(-MAX_HISTORY),
        future: [],
      };
    });
  },
  setPaletteDragging: (on) => set((state) => (state.paletteDragging === on ? state : { paletteDragging: on })),
  clearPortWarning: () => set((state) => (state.portWarning == null ? state : { portWarning: null })),
  addPortAt: (pos) =>
    set((state) => {
      const key = posKey(pos);
      // Ports live at cube positions only (every coord divisible by 3).
      if (!isValidBlockPos(pos)) return { portWarning: "Port positions must be on the cube grid." };
      if (state.blocks.has(key)) {
        const block = state.blocks.get(key)!;
        return {
          portWarning: isPipeType(block.type)
            ? "A pipe occupies this position."
            : "A cube already exists here; remove it first.",
        };
      }
      if (state.portPositions.has(key)) return state; // already a port
      const newPorts = new Set(state.portPositions);
      newPorts.add(key);
      const cmd: UndoCommand = { kind: "add-port", key };
      return {
        portPositions: newPorts,
        history: [...state.history, cmd].slice(-MAX_HISTORY),
        future: [],
        portWarning: null,
      };
    }),
  removePortAt: (pos) =>
    set((state) => {
      const key = posKey(pos);
      if (!state.portPositions.has(key)) return state;
      const newPorts = new Set(state.portPositions);
      newPorts.delete(key);
      const cmd: UndoCommand = { kind: "remove-port", key };
      return {
        portPositions: newPorts,
        history: [...state.history, cmd].slice(-MAX_HISTORY),
        future: [],
      };
    }),
  convertBlockToPort: (pos) =>
    set((state) => {
      const key = posKey(pos);
      const block = state.blocks.get(key);
      if (!block) return state;
      // Converting a pipe to a port makes no sense — pipes aren't cube-slot blocks.
      if (isPipeType(block.type)) {
        return { portWarning: "Only cubes can be converted to a port." };
      }
      const pipeCount = countAttachedPipes(pos, state.blocks);
      if (pipeCount >= 2) {
        return { portWarning: `Cannot convert: ${pipeCount} pipes attached. Remove pipes first.` };
      }
      // 0 or 1 attached pipes: remove the cube. The freed slot becomes an explicit
      // port marker so the user's "I want a port here" intent persists even if
      // all adjacent pipes are later removed.
      const { blocks, hiddenFaces } = doRemove(state.blocks, state.spatialIndex, state.hiddenFaces, key, block);
      const cmd: UndoCommand = { kind: "remove", key, block };
      const newUndetermined = new Map(state.undeterminedCubes);
      newUndetermined.delete(key);
      const newPorts = new Set(state.portPositions);
      newPorts.add(key);
      return {
        blocks,
        hiddenFaces,
        history: [...state.history, cmd].slice(-MAX_HISTORY),
        future: [],
        hoveredGridPos: null,
        hoveredBlockType: null,
        hoveredInvalid: false,
        hoveredInvalidReason: null,
        portWarning: null,
        undeterminedCubes: newUndetermined,
        portPositions: newPorts,
      };
    }),
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

      // Validate position parity. For pipes, this guards against a historical
      // snapping bug where a pipe could land half-on-a-cube.
      if (!isValidPos(pos, blockType)) {
        if (isPipeType(blockType)) {
          console.warn(
            `[pipe-snap] rejected invalid pipe position ${posKey(pos)} for type ${blockType}`,
          );
        }
        return state;
      }
      if (hasBlockOverlap(pos, blockType, state.blocks, state.spatialIndex, existing ? key : undefined)) return state;
      if (!store.freeBuild) {
        if (isPipeType(blockType) && hasPipeColorConflict(blockType, pos, state.blocks)) return state;
        if (!isPipeType(blockType) && blockType !== "Y" && hasCubeColorConflict(blockType as CubeType, pos, state.blocks)) return state;
        if (hasYCubePipeAxisConflict(blockType, pos, state.blocks)) return state;
      }

      // For replacement (existing block at this pos), spread `existing` so
      // optional metadata (e.g. groupId) rides through the type swap. For
      // fresh placement, start with no metadata.
      const block: Block = existing
        ? { ...existing, pos, type: blockType }
        : { pos, type: blockType };

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

      const addResult = doAdd(state.blocks, state.spatialIndex, state.hiddenFaces, key, block);
      let blocks = addResult.blocks;
      let hiddenFaces = addResult.hiddenFaces;
      let cmd: UndoCommand = { kind: "add", key, block };

      // If we just placed a pipe, promote any endpoints that now have ≥2 pipes.
      if (isPipeType(blockType)) {
        const sync = syncPortsAndPromote(blocks, state.spatialIndex, hiddenFaces, state.portPositions);
        if (sync.addedEntries.length > 0) {
          blocks = sync.blocks;
          hiddenFaces = sync.hiddenFaces;
          cmd = { kind: "bulk-add", entries: [{ key, block }, ...sync.addedEntries] };
        }
        // Note: portPositions drops below don't need undo bookkeeping — on undo
        // the newly-placed cubes are removed, which naturally makes that
        // position an implicit port again until the user re-places one.
        if (sync.promotedPortKeys.length > 0) {
          const newPorts = new Set(state.portPositions);
          for (const k of sync.promotedPortKeys) newPorts.delete(k);
          return {
            blocks,
            hiddenFaces,
            history: [...state.history, cmd].slice(-MAX_HISTORY),
            future: [],
            portPositions: newPorts,
          };
        }
      }

      // Placing a non-pipe cube at a user-placed port clears the port marker.
      if (state.portPositions.has(key)) {
        const newPorts = new Set(state.portPositions);
        newPorts.delete(key);
        return {
          blocks,
          hiddenFaces,
          history: [...state.history, cmd].slice(-MAX_HISTORY),
          future: [],
          portPositions: newPorts,
        };
      }

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

      // Junction-cube cascade: removing a cube with ≥2 attached pipes would orphan
      // the pipes (each becomes a dangling segment with two ports). Take them out
      // in the same operation so the model stays consistent. Single-pipe and
      // pipeless cubes delete cleanly without cascade.
      const cascadeKeys = !isPipeType(block.type) && countAttachedPipes(pos, state.blocks) >= 2
        ? getAttachedPipeKeys(pos, state.blocks)
        : [];

      if (cascadeKeys.length === 0) {
        const { blocks, hiddenFaces } = doRemove(state.blocks, state.spatialIndex, state.hiddenFaces, key, block);
        const newUndetermined = new Map(state.undeterminedCubes);
        newUndetermined.delete(key);
        const removedPipes = isPipeType(block.type)
          ? [{ pos: block.pos, type: block.type as PipeType }]
          : [];
        const orphanedPortKeys = removedPipes.length > 0
          ? orphanedPortKeysFromRemovedPipes(removedPipes, blocks, state.portPositions)
          : [];
        // Auto-dissolve: single-block delete must also restore the ≥2-member
        // group invariant for any group the deleted block belonged to.
        const dissolved = applyAutoDissolve(blocks, [{ key, block }]);
        const finalBlocks = dissolved.blocks;
        dissolveToast(dissolved.autoDissolvedFor);
        if (orphanedPortKeys.length === 0) {
          const cmd: UndoCommand = {
            kind: "remove",
            key,
            block,
            ...(dissolved.autoDissolvedFor.length > 0 ? { autoDissolvedFor: dissolved.autoDissolvedFor } : {}),
          };
          return {
            blocks: finalBlocks,
            hiddenFaces,
            history: [...state.history, cmd].slice(-MAX_HISTORY),
            future: [],
            hoveredGridPos: null,
            undeterminedCubes: newUndetermined,
          };
        }
        const portPositions = new Set(state.portPositions);
        for (const k of orphanedPortKeys) portPositions.delete(k);
        const cmd: UndoCommand = {
          kind: "bulk-remove",
          entries: [{ key, block }],
          portKeys: orphanedPortKeys,
          ...(dissolved.autoDissolvedFor.length > 0 ? { autoDissolvedFor: dissolved.autoDissolvedFor } : {}),
        };
        return {
          blocks: finalBlocks,
          hiddenFaces,
          portPositions,
          history: [...state.history, cmd].slice(-MAX_HISTORY),
          future: [],
          hoveredGridPos: null,
          undeterminedCubes: newUndetermined,
        };
      }

      const entries: Array<{ key: string; block: Block }> = [{ key, block }];
      const removedPipes: Array<{ pos: Position3D; type: PipeType }> = isPipeType(block.type)
        ? [{ pos: block.pos, type: block.type as PipeType }]
        : [];
      let blocks = state.blocks;
      let hiddenFaces = state.hiddenFaces;
      ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, key, block));
      const newUndetermined = new Map(state.undeterminedCubes);
      newUndetermined.delete(key);
      for (const ck of cascadeKeys) {
        const cb = blocks.get(ck);
        if (!cb) continue;
        entries.push({ key: ck, block: cb });
        if (isPipeType(cb.type)) removedPipes.push({ pos: cb.pos, type: cb.type as PipeType });
        ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, ck, cb));
        newUndetermined.delete(ck);
      }
      const orphanedPortKeys = orphanedPortKeysFromRemovedPipes(removedPipes, blocks, state.portPositions);
      let portPositions = state.portPositions;
      if (orphanedPortKeys.length > 0) {
        portPositions = new Set(state.portPositions);
        for (const k of orphanedPortKeys) portPositions.delete(k);
      }
      // Auto-dissolve: junction-cube cascade can also drop a group below 2.
      const dissolved = applyAutoDissolve(blocks, entries);
      blocks = dissolved.blocks;
      dissolveToast(dissolved.autoDissolvedFor);
      const cmd: UndoCommand = {
        kind: "bulk-remove",
        entries,
        ...(orphanedPortKeys.length > 0 ? { portKeys: orphanedPortKeys } : {}),
        ...(dissolved.autoDissolvedFor.length > 0 ? { autoDissolvedFor: dissolved.autoDissolvedFor } : {}),
      };
      return {
        blocks,
        hiddenFaces,
        portPositions,
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
        const added = doAdd(state.blocks, state.spatialIndex, state.hiddenFaces, cmd.key, cmd.block);
        let blocks = added.blocks;
        const hiddenFaces = added.hiddenFaces;
        // Restore any survivor groupId that this remove auto-dissolved.
        if (cmd.autoDissolvedFor && cmd.autoDissolvedFor.length > 0) {
          const newBlocks = new Map(blocks);
          for (const a of cmd.autoDissolvedFor) {
            const b = newBlocks.get(a.survivorKey);
            if (!b) continue;
            newBlocks.set(a.survivorKey, { ...b, groupId: a.priorGroupId });
          }
          blocks = newBlocks;
        }
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
        // Restore any group-membership that was auto-cleared on the survivor
        // when the original delete dropped the group below 2 members.
        if (cmd.autoDissolvedFor && cmd.autoDissolvedFor.length > 0) {
          const newBlocks = new Map(blocks);
          for (const a of cmd.autoDissolvedFor) {
            const b = newBlocks.get(a.survivorKey);
            if (!b) continue;
            newBlocks.set(a.survivorKey, { ...b, groupId: a.priorGroupId });
          }
          blocks = newBlocks;
        }
        let portPositions = state.portPositions;
        if (cmd.portKeys && cmd.portKeys.length > 0) {
          portPositions = new Set(portPositions);
          for (const k of cmd.portKeys) portPositions.add(k);
        }
        return {
          blocks,
          hiddenFaces,
          portPositions,
          history: newHistory,
          future: [cmd, ...state.future].slice(0, MAX_HISTORY),
          hoveredGridPos: null,
        };
      }

      if (cmd.kind === "bulk-add") {
        // Remove in reverse order so auto-promoted cubes disappear before the pipe that caused them.
        let { blocks, hiddenFaces } = { blocks: state.blocks, hiddenFaces: state.hiddenFaces };
        for (let i = cmd.entries.length - 1; i >= 0; i--) {
          const entry = cmd.entries[i];
          ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, entry.key, entry.block));
        }
        return {
          blocks,
          hiddenFaces,
          history: newHistory,
          future: [cmd, ...state.future].slice(0, MAX_HISTORY),
          hoveredGridPos: null,
        };
      }

      if (cmd.kind === "bulk-move") {
        let blocks = state.blocks;
        let hiddenFaces = state.hiddenFaces;
        for (const e of cmd.entries) {
          ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, e.newKey, e.newBlock));
        }
        for (const e of cmd.entries) {
          ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, e.oldKey, e.oldBlock));
        }
        const newUndetermined = new Map(state.undeterminedCubes);
        for (const e of cmd.entries) {
          const info = newUndetermined.get(e.newKey);
          newUndetermined.delete(e.newKey);
          if (info) newUndetermined.set(e.oldKey, info);
        }
        return {
          blocks,
          hiddenFaces,
          history: newHistory,
          future: [cmd, ...state.future].slice(0, MAX_HISTORY),
          hoveredGridPos: null,
          selectedKeys: new Set(cmd.entries.map((e) => e.oldKey)),
          selectionPivot: null,
          undeterminedCubes: newUndetermined,
        };
      }

      if (cmd.kind === "load") {
        // Undo a load — restore the state before the import. Includes the
        // port state so a shared-scene "load" round-trips cleanly.
        const newIndex = buildSpatialIndex(cmd.savedBlocks);
        return {
          blocks: cmd.savedBlocks,
          spatialIndex: newIndex,
          hiddenFaces: cmd.savedHiddenFaces,
          history: newHistory,
          future: [cmd, ...state.future].slice(0, MAX_HISTORY),
          hoveredGridPos: null,
          undeterminedCubes: cmd.savedUndetermined,
          portMeta: cmd.savedPortMeta,
          portPositions: cmd.savedPortPositions,
        };
      }

      if (cmd.kind === "build-step") {
        const step = cmd.step;
        let { blocks, hiddenFaces } = { blocks: state.blocks, hiddenFaces: state.hiddenFaces };
        const newUndetermined = new Map(state.undeterminedCubes);
        let nextPortPositions = state.portPositions;

        // Roll back any auto-promoted cubes first (they were inserted last in buildMove
        // so they must be removed first to keep the spatial index consistent).
        if (step.autoPromoted && step.autoPromoted.length > 0) {
          for (const ap of step.autoPromoted) {
            const cur = blocks.get(ap.key);
            if (cur) ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, ap.key, cur));
            newUndetermined.delete(ap.key);
          }
          const userPortKeys = step.autoPromoted.filter(ap => ap.wasUserPort).map(ap => ap.key);
          if (userPortKeys.length > 0) {
            nextPortPositions = new Set(state.portPositions);
            for (const k of userPortKeys) nextPortPositions.add(k);
          }
        }

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
            ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, dtc.key, { ...curDest, type: dtc.prevType }));
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
          portPositions: nextPortPositions,
        };
      }

      if (cmd.kind === "pipe-cycle") {
        let { blocks, hiddenFaces } = { blocks: state.blocks, hiddenFaces: state.hiddenFaces };
        const newUndetermined = new Map(state.undeterminedCubes);

        const pipeBlock = blocks.get(cmd.pipeKey);
        if (pipeBlock) {
          ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, cmd.pipeKey, pipeBlock));
          ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, cmd.pipeKey, { ...pipeBlock, type: cmd.oldType }));
        }
        if (cmd.retyped) {
          for (const rd of cmd.retyped) {
            const cubeBlock = blocks.get(rd.cubeKey);
            if (cubeBlock) {
              ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, rd.cubeKey, cubeBlock));
              ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, rd.cubeKey, { ...cubeBlock, type: rd.oldType }));
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
        // Re-add old cube — preserve `groupId` from the (now-removed) current cube.
        if (cmd.oldPlacedType) {
          const restored: Block = cubeBlock
            ? { ...cubeBlock, type: cmd.oldPlacedType }
            : { pos: cmd.cubePos, type: cmd.oldPlacedType };
          ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, cmd.cubeKey, restored));
        }
        // Revert pipe updates
        if (cmd.oldPipes) {
          for (const pu of cmd.oldPipes) {
            const pb = blocks.get(pu.key);
            if (pb) {
              ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, pu.key, pb));
              ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, pu.key, { ...pb, type: pu.oldType }));
            }
          }
        }
        // Restore undetermined state
        if (cmd.oldUndetermined) newUndetermined.set(cmd.cubeKey, cmd.oldUndetermined);
        else newUndetermined.delete(cmd.cubeKey);
        // Restore neighbour undetermined entries that were refreshed by the cycle
        if (cmd.undeterminedNeighbors) {
          for (const u of cmd.undeterminedNeighbors) {
            if (u.oldInfo) newUndetermined.set(u.key, { ...u.oldInfo, options: [...u.oldInfo.options] });
            else newUndetermined.delete(u.key);
          }
        }
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

      if (cmd.kind === "edit-type-cycle") {
        let { blocks, hiddenFaces } = { blocks: state.blocks, hiddenFaces: state.hiddenFaces };
        if (cmd.newBlock) {
          ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, cmd.key, cmd.newBlock));
        }
        if (cmd.oldBlock) {
          ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, cmd.key, cmd.oldBlock));
        }
        // Revert pipe retypes
        if (cmd.oldPipes) {
          for (const pu of cmd.oldPipes) {
            const pb = blocks.get(pu.key);
            if (pb) {
              ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, pu.key, pb));
              ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, pu.key, { ...pb, type: pu.oldType }));
            }
          }
        }
        const newPorts = new Set(state.portPositions);
        if (cmd.oldPortMarker) newPorts.add(cmd.key); else newPorts.delete(cmd.key);
        // Restore neighbour undetermined entries
        const newUndetermined = new Map(state.undeterminedCubes);
        if (cmd.undeterminedNeighbors) {
          for (const u of cmd.undeterminedNeighbors) {
            if (u.oldInfo) newUndetermined.set(u.key, { ...u.oldInfo, options: [...u.oldInfo.options] });
            else newUndetermined.delete(u.key);
          }
        }
        return {
          blocks,
          hiddenFaces,
          portPositions: newPorts,
          selectedKeys: new Set(cmd.prevSelectedKeys),
          selectedPortPositions: new Set(cmd.prevSelectedPortPositions),
          undeterminedCubes: newUndetermined,
          history: newHistory,
          future: [cmd, ...state.future].slice(0, MAX_HISTORY),
          hoveredGridPos: null,
        };
      }

      if (cmd.kind === "add-port") {
        const newPorts = new Set(state.portPositions);
        newPorts.delete(cmd.key);
        return {
          portPositions: newPorts,
          history: newHistory,
          future: [cmd, ...state.future].slice(0, MAX_HISTORY),
        };
      }

      if (cmd.kind === "remove-port") {
        const newPorts = new Set(state.portPositions);
        newPorts.add(cmd.key);
        return {
          portPositions: newPorts,
          history: newHistory,
          future: [cmd, ...state.future].slice(0, MAX_HISTORY),
        };
      }

      if (cmd.kind === "bulk-replace") {
        let { blocks, hiddenFaces } = { blocks: state.blocks, hiddenFaces: state.hiddenFaces };
        for (const e of cmd.entries) {
          ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, e.key, e.newBlock));
          ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, e.key, e.oldBlock));
        }
        const newUndetermined = new Map(state.undeterminedCubes);
        for (const u of cmd.undeterminedChanges) {
          if (u.oldInfo) newUndetermined.set(u.key, { ...u.oldInfo, options: [...u.oldInfo.options] });
          else newUndetermined.delete(u.key);
        }
        return {
          blocks,
          hiddenFaces,
          history: newHistory,
          future: [cmd, ...state.future].slice(0, MAX_HISTORY),
          hoveredGridPos: null,
          undeterminedCubes: newUndetermined,
        };
      }

      if (cmd.kind === "rotate-selection") {
        let { blocks, hiddenFaces } = { blocks: state.blocks, hiddenFaces: state.hiddenFaces };
        for (const entry of cmd.entries) {
          const cur = blocks.get(entry.newKey);
          if (cur) {
            ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, entry.newKey, cur));
          }
        }
        for (const entry of cmd.entries) {
          ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, entry.oldKey, entry.oldBlock));
        }
        return {
          blocks,
          hiddenFaces,
          history: newHistory,
          future: [cmd, ...state.future].slice(0, MAX_HISTORY),
          hoveredGridPos: null,
          selectedKeys: new Set(cmd.prevSelectedKeys),
          selectionPivot: null,
        };
      }

      if (cmd.kind === "group-create") {
        // Undo: restore each block's prior groupId (typically undefined).
        const newBlocks = new Map(state.blocks);
        for (const e of cmd.entries) {
          const b = newBlocks.get(e.key);
          if (!b) continue;
          if (e.prevGroupId === undefined) {
            newBlocks.set(e.key, withoutGroupId(b));
          } else {
            newBlocks.set(e.key, { ...b, groupId: e.prevGroupId });
          }
        }
        return {
          blocks: newBlocks,
          history: newHistory,
          future: [cmd, ...state.future].slice(0, MAX_HISTORY),
        };
      }

      if (cmd.kind === "ungroup") {
        // Undo: restore each block's prior groupId.
        const newBlocks = new Map(state.blocks);
        for (const e of cmd.entries) {
          const b = newBlocks.get(e.key);
          if (!b) continue;
          newBlocks.set(e.key, { ...b, groupId: e.groupId });
        }
        return {
          blocks: newBlocks,
          history: newHistory,
          future: [cmd, ...state.future].slice(0, MAX_HISTORY),
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
        const removed = doRemove(state.blocks, state.spatialIndex, state.hiddenFaces, cmd.key, cmd.block);
        let blocks = removed.blocks;
        const hiddenFaces = removed.hiddenFaces;
        // Re-clear any survivor groupId that the original remove auto-dissolved.
        if (cmd.autoDissolvedFor && cmd.autoDissolvedFor.length > 0) {
          const newBlocks = new Map(blocks);
          for (const a of cmd.autoDissolvedFor) {
            const b = newBlocks.get(a.survivorKey);
            if (!b) continue;
            newBlocks.set(a.survivorKey, withoutGroupId(b));
          }
          blocks = newBlocks;
        }
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
        // Re-clear any survivor groupId that the original delete auto-dissolved.
        if (cmd.autoDissolvedFor && cmd.autoDissolvedFor.length > 0) {
          const newBlocks = new Map(blocks);
          for (const a of cmd.autoDissolvedFor) {
            const b = newBlocks.get(a.survivorKey);
            if (!b) continue;
            newBlocks.set(a.survivorKey, withoutGroupId(b));
          }
          blocks = newBlocks;
        }
        let portPositions = state.portPositions;
        if (cmd.portKeys && cmd.portKeys.length > 0) {
          portPositions = new Set(portPositions);
          for (const k of cmd.portKeys) portPositions.delete(k);
        }
        return {
          blocks,
          hiddenFaces,
          portPositions,
          history: [...state.history, cmd],
          future: newFuture,
          hoveredGridPos: null,
          selectedKeys: new Set<string>(),
          selectedPortPositions: new Set<string>(),
          selectionPivot: null,
        };
      }

      if (cmd.kind === "bulk-add") {
        let { blocks, hiddenFaces } = { blocks: state.blocks, hiddenFaces: state.hiddenFaces };
        for (const entry of cmd.entries) {
          ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, entry.key, entry.block));
        }
        return {
          blocks,
          hiddenFaces,
          history: [...state.history, cmd],
          future: newFuture,
          hoveredGridPos: null,
        };
      }

      if (cmd.kind === "bulk-move") {
        let blocks = state.blocks;
        let hiddenFaces = state.hiddenFaces;
        for (const e of cmd.entries) {
          ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, e.oldKey, e.oldBlock));
        }
        for (const e of cmd.entries) {
          ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, e.newKey, e.newBlock));
        }
        const newUndetermined = new Map(state.undeterminedCubes);
        for (const e of cmd.entries) {
          const info = newUndetermined.get(e.oldKey);
          newUndetermined.delete(e.oldKey);
          if (info) newUndetermined.set(e.newKey, info);
        }
        return {
          blocks,
          hiddenFaces,
          history: [...state.history, cmd],
          future: newFuture,
          hoveredGridPos: null,
          selectedKeys: new Set(cmd.entries.map((e) => e.newKey)),
          selectionPivot: null,
          undeterminedCubes: newUndetermined,
        };
      }

      if (cmd.kind === "load") {
        // Redo a load — restore the imported state, including ports.
        return {
          blocks: cmd.newBlocks,
          spatialIndex: cmd.newIndex,
          hiddenFaces: cmd.newHiddenFaces,
          history: [...state.history, cmd],
          future: newFuture,
          hoveredGridPos: null,
          undeterminedCubes: new Map(),
          portMeta: cmd.newPortMeta,
          portPositions: cmd.newPortPositions,
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
            ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, dtc.key, { ...curDest, type: dtc.newType }));
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
        // Re-apply auto-promoted port → cube replacements
        let nextPortPositionsRedo = state.portPositions;
        if (step.autoPromoted && step.autoPromoted.length > 0) {
          for (const ap of step.autoPromoted) {
            if (!blocks.has(ap.key)) {
              ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, ap.key, ap.block));
            }
          }
          const userPortKeys = step.autoPromoted.filter(ap => ap.wasUserPort).map(ap => ap.key);
          if (userPortKeys.length > 0) {
            nextPortPositionsRedo = new Set(state.portPositions);
            for (const k of userPortKeys) nextPortPositionsRedo.delete(k);
          }
        }

        const newBuildHistory = [...state.buildHistory, step];

        return {
          blocks,
          hiddenFaces,
          history: [...state.history, cmd],
          future: newFuture,
          hoveredGridPos: null,
          buildCursor: step.destCursorPos,
          buildHistory: newBuildHistory,
          undeterminedCubes: newUndetermined,
          portPositions: nextPortPositionsRedo,
        };
      }

      if (cmd.kind === "pipe-cycle") {
        let { blocks, hiddenFaces } = { blocks: state.blocks, hiddenFaces: state.hiddenFaces };
        const newUndetermined = new Map(state.undeterminedCubes);

        const pipeBlock = blocks.get(cmd.pipeKey);
        if (pipeBlock) {
          ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, cmd.pipeKey, pipeBlock));
          ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, cmd.pipeKey, { ...pipeBlock, type: cmd.newType }));
        }
        if (cmd.retyped) {
          for (const rd of cmd.retyped) {
            const cubeBlock = blocks.get(rd.cubeKey);
            if (cubeBlock) {
              ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, rd.cubeKey, cubeBlock));
              ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, rd.cubeKey, { ...cubeBlock, type: rd.newType }));
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
        // Re-add new cube (unless cycling ended at the port slot) — preserve `groupId`.
        if (cmd.newPlacedType) {
          const restored: Block = cubeBlock
            ? { ...cubeBlock, type: cmd.newPlacedType }
            : { pos: cmd.cubePos, type: cmd.newPlacedType };
          ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, cmd.cubeKey, restored));
        }
        if (cmd.oldPipes) {
          for (const pu of cmd.oldPipes) {
            const pb = blocks.get(pu.key);
            if (pb) {
              ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, pu.key, pb));
              ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, pu.key, { ...pb, type: pu.newType }));
            }
          }
        }
        // Restore undetermined state
        if (cmd.newUndetermined) newUndetermined.set(cmd.cubeKey, cmd.newUndetermined);
        else newUndetermined.delete(cmd.cubeKey);
        // Re-apply neighbour undetermined refresh from the original cycle
        if (cmd.undeterminedNeighbors) {
          for (const u of cmd.undeterminedNeighbors) {
            if (u.newInfo) newUndetermined.set(u.key, { ...u.newInfo, options: [...u.newInfo.options] });
            else newUndetermined.delete(u.key);
          }
        }
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

      if (cmd.kind === "edit-type-cycle") {
        let { blocks, hiddenFaces } = { blocks: state.blocks, hiddenFaces: state.hiddenFaces };
        if (cmd.oldBlock) {
          ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, cmd.key, cmd.oldBlock));
        }
        if (cmd.newBlock) {
          ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, cmd.key, cmd.newBlock));
        }
        // Re-apply pipe retypes
        if (cmd.oldPipes) {
          for (const pu of cmd.oldPipes) {
            const pb = blocks.get(pu.key);
            if (pb) {
              ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, pu.key, pb));
              ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, pu.key, { ...pb, type: pu.newType }));
            }
          }
        }
        const newPorts = new Set(state.portPositions);
        if (cmd.newPortMarker) newPorts.add(cmd.key); else newPorts.delete(cmd.key);
        // Re-apply neighbour undetermined refresh
        const newUndetermined = new Map(state.undeterminedCubes);
        if (cmd.undeterminedNeighbors) {
          for (const u of cmd.undeterminedNeighbors) {
            if (u.newInfo) newUndetermined.set(u.key, { ...u.newInfo, options: [...u.newInfo.options] });
            else newUndetermined.delete(u.key);
          }
        }
        return {
          blocks,
          hiddenFaces,
          portPositions: newPorts,
          selectedKeys: new Set(cmd.nextSelectedKeys),
          selectedPortPositions: new Set(cmd.nextSelectedPortPositions),
          undeterminedCubes: newUndetermined,
          history: [...state.history, cmd],
          future: newFuture,
          hoveredGridPos: null,
        };
      }

      if (cmd.kind === "add-port") {
        const newPorts = new Set(state.portPositions);
        newPorts.add(cmd.key);
        return {
          portPositions: newPorts,
          history: [...state.history, cmd],
          future: newFuture,
        };
      }

      if (cmd.kind === "remove-port") {
        const newPorts = new Set(state.portPositions);
        newPorts.delete(cmd.key);
        return {
          portPositions: newPorts,
          history: [...state.history, cmd],
          future: newFuture,
        };
      }

      if (cmd.kind === "bulk-replace") {
        let { blocks, hiddenFaces } = { blocks: state.blocks, hiddenFaces: state.hiddenFaces };
        for (const e of cmd.entries) {
          ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, e.key, e.oldBlock));
          ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, e.key, e.newBlock));
        }
        const newUndetermined = new Map(state.undeterminedCubes);
        for (const u of cmd.undeterminedChanges) {
          if (u.newInfo) newUndetermined.set(u.key, { ...u.newInfo, options: [...u.newInfo.options] });
          else newUndetermined.delete(u.key);
        }
        return {
          blocks,
          hiddenFaces,
          history: [...state.history, cmd],
          future: newFuture,
          hoveredGridPos: null,
          undeterminedCubes: newUndetermined,
        };
      }

      if (cmd.kind === "rotate-selection") {
        let { blocks, hiddenFaces } = { blocks: state.blocks, hiddenFaces: state.hiddenFaces };
        for (const entry of cmd.entries) {
          const cur = blocks.get(entry.oldKey);
          if (cur) {
            ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, entry.oldKey, cur));
          }
        }
        for (const entry of cmd.entries) {
          ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, entry.newKey, entry.newBlock));
        }
        return {
          blocks,
          hiddenFaces,
          history: [...state.history, cmd],
          future: newFuture,
          hoveredGridPos: null,
          selectedKeys: new Set(cmd.nextSelectedKeys),
          selectionPivot: null,
        };
      }

      if (cmd.kind === "group-create") {
        // Redo: re-stamp newGroupId onto each entry's block.
        const newBlocks = new Map(state.blocks);
        for (const e of cmd.entries) {
          const b = newBlocks.get(e.key);
          if (!b) continue;
          newBlocks.set(e.key, { ...b, groupId: cmd.newGroupId });
        }
        return {
          blocks: newBlocks,
          history: [...state.history, cmd],
          future: newFuture,
        };
      }

      if (cmd.kind === "ungroup") {
        // Redo: clear groupId on each entry's block.
        const newBlocks = new Map(state.blocks);
        for (const e of cmd.entries) {
          const b = newBlocks.get(e.key);
          if (!b) continue;
          newBlocks.set(e.key, withoutGroupId(b));
        }
        return {
          blocks: newBlocks,
          history: [...state.history, cmd],
          future: newFuture,
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

  loadBlocks: (incoming, ports) =>
    set((state) => {
      const noChange =
        incoming.size === 0 &&
        state.blocks.size === 0 &&
        (!ports || (ports.portMeta.size === 0 && ports.portPositions.size === 0));
      if (noChange) return state;
      const { spatialIndex, hiddenFaces, undeterminedCubes } = computeDerivedFromBlocks(incoming);
      // When `ports` is omitted (template loads, .dae imports), preserve
      // existing portMeta and clear portPositions — matches prior behavior.
      // When provided (applySnapshot('load') from a shared scene), replace
      // both atomically so undo can roll the entire load back.
      const newPortMeta = ports ? ports.portMeta : state.portMeta;
      const newPortPositions = ports ? ports.portPositions : new Set<string>();
      const cmd: UndoCommand = {
        kind: "load",
        savedBlocks: state.blocks,
        savedHiddenFaces: state.hiddenFaces,
        savedUndetermined: state.undeterminedCubes,
        savedPortMeta: state.portMeta,
        savedPortPositions: state.portPositions,
        newBlocks: incoming,
        newIndex: spatialIndex,
        newHiddenFaces: hiddenFaces,
        newPortMeta,
        newPortPositions,
      };
      return {
        blocks: incoming,
        spatialIndex,
        hiddenFaces,
        history: [...state.history, cmd].slice(-MAX_HISTORY),
        future: [],
        hoveredGridPos: null,
        undeterminedCubes,
        portMeta: newPortMeta,
        portPositions: newPortPositions,
      };
    }),

  insertBlocks: (incoming) =>
    set((state) => {
      if (incoming.size === 0) return state;

      // Offset along +X so incoming sits past the existing scene's right edge,
      // with a one-cube gap. Delta components must be multiples of 3 to keep
      // cubes on block-slots and pipes on pipe-slots (grid period = 3).
      let delta: Position3D = { x: 0, y: 0, z: 0 };
      if (state.blocks.size > 0) {
        let existingMaxX = -Infinity;
        for (const b of state.blocks.values()) {
          if (b.pos.x > existingMaxX) existingMaxX = b.pos.x;
        }
        let incomingMinX = Infinity;
        for (const b of incoming.values()) {
          if (b.pos.x < incomingMinX) incomingMinX = b.pos.x;
        }
        const raw = existingMaxX + 3 - incomingMinX;
        delta = { x: Math.ceil(raw / 3) * 3, y: 0, z: 0 };
      }

      return mergeBlocksWithDelta(state, incoming, delta) ?? state;
    }),

  copySelection: () =>
    set((state) => {
      if (state.selectedKeys.size === 0) return state;
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      for (const key of state.selectedKeys) {
        const b = state.blocks.get(key);
        if (!b) continue;
        if (b.pos.x < minX) minX = b.pos.x;
        if (b.pos.y < minY) minY = b.pos.y;
        if (b.pos.z < minZ) minZ = b.pos.z;
      }
      if (minX === Infinity) return state;
      const clipboard = new Map<string, Block>();
      for (const key of state.selectedKeys) {
        const b = state.blocks.get(key);
        if (!b) continue;
        const pos: Position3D = { x: b.pos.x - minX, y: b.pos.y - minY, z: b.pos.z - minZ };
        // Preserve `groupId` so paste can re-stamp a fresh nanoid per source
        // group (see commitPasteReducer's two-phase paste). Spreading `b` also
        // carries any future Block metadata fields automatically.
        clipboard.set(posKey(pos), { ...b, pos });
      }
      if (clipboard.size === 0) return state;
      return { clipboard };
    }),

  pasteClipboard: () =>
    set((state) => {
      const clip = state.clipboard;
      if (!clip || clip.size === 0) return state;
      // Second invocation while paste is armed → commit at hover.
      if (state.armedTool === "paste") {
        return commitPasteReducer(state);
      }
      return {
        armedTool: "paste",
        mode: "edit",
        pipeVariant: null,
        portWarning: null,
        hoveredGridPos: null,
        hoveredBlockType: null,
        hoveredInvalid: false,
        hoveredInvalidReason: null,
        hoveredReplace: false,
        selectedKeys: new Set<string>(),
        selectedPortPositions: new Set<string>(),
        selectionPivot: null,
      };
    }),

  commitPaste: () =>
    set((state) => commitPasteReducer(state)),

  hydrateBlocks: (incoming) =>
    set(() => {
      // Run unconditionally — even with empty `incoming`, callers
      // (applySnapshot from a shared port-only scene, or autosave with no
      // blocks) need derived state and selection to reset. Returning early
      // on empty input previously left stale spatialIndex/hiddenFaces
      // grafted onto whatever ports the same applySnapshot wrote next.
      const { spatialIndex, hiddenFaces } = computeDerivedFromBlocks(incoming);
      return {
        blocks: incoming,
        spatialIndex,
        hiddenFaces,
        hoveredGridPos: null,
        selectedKeys: new Set<string>(),
        selectedPortPositions: new Set<string>(),
        portPositions: new Set<string>(),
        selectionPivot: null,
        undeterminedCubes: new Map(),
      };
    }),

  clearAll: () =>
    set((state) => {
      if (state.blocks.size === 0 && state.portPositions.size === 0) return state;
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
        selectedPortPositions: new Set<string>(),
        portPositions: new Set<string>(),
        selectionPivot: null,
        undeterminedCubes: new Map(),
        armedTool: "port",
        pipeVariant: null,
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
      return {
        selectedKeys: next,
        selectedPortPositions: additive ? state.selectedPortPositions : new Set<string>(),
        selectionPivot: null,
      };
    }),

  clearSelection: () =>
    set((state) => {
      if (state.selectedKeys.size === 0 && state.selectedPortPositions.size === 0) return state;
      return { selectedKeys: new Set<string>(), selectedPortPositions: new Set<string>(), selectionPivot: null };
    }),

  togglePortSelection: (pos, additive) =>
    set((state) => {
      const key = posKey(pos);
      const next = additive ? new Set(state.selectedPortPositions) : new Set<string>();
      if (additive && next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      // Selecting a port clears any block selection (single focus).
      return {
        selectedPortPositions: next,
        selectedKeys: additive ? state.selectedKeys : new Set<string>(),
        selectionPivot: null,
      };
    }),

  clearPortSelection: () =>
    set((state) => {
      if (state.selectedPortPositions.size === 0) return state;
      return { selectedPortPositions: new Set<string>() };
    }),

  // -------------------------------------------------------------------------
  // Group actions — `groupId?: string` rides on each Block as metadata, so
  // existing block mutators (rotate, flip, bulk-move, etc.) preserve group
  // membership via spread `{ ...block, type: X }`. Group create/dissolve has
  // its own UndoCommand kinds.
  // -------------------------------------------------------------------------

  groupSelected: (memberKeys) =>
    set((state) => {
      if (memberKeys.size < 2) return state;
      const newGroupId = genNewGroupId();
      const entries: Array<{ key: string; prevGroupId: string | undefined }> = [];
      const newBlocks = new Map(state.blocks);
      for (const key of memberKeys) {
        const block = newBlocks.get(key);
        if (!block) continue;
        entries.push({ key, prevGroupId: block.groupId });
        newBlocks.set(key, { ...block, groupId: newGroupId });
      }
      if (entries.length === 0) return state;
      const cmd: UndoCommand = { kind: "group-create", entries, newGroupId };
      return {
        blocks: newBlocks,
        history: [...state.history, cmd].slice(-MAX_HISTORY),
        future: [],
      };
    }),

  ungroupSelected: (groupId) =>
    set((state) => {
      const memberKeys = listGroupMembers(state.blocks, groupId);
      if (memberKeys.length === 0) return state;
      const entries: Array<{ key: string; groupId: string }> = [];
      const newBlocks = new Map(state.blocks);
      for (const key of memberKeys) {
        const block = newBlocks.get(key);
        if (!block) continue;
        entries.push({ key, groupId });
        newBlocks.set(key, withoutGroupId(block));
      }
      if (entries.length === 0) return state;
      const cmd: UndoCommand = { kind: "ungroup", entries };
      return {
        blocks: newBlocks,
        history: [...state.history, cmd].slice(-MAX_HISTORY),
        future: [],
      };
    }),

  groupToggle: () => {
    const state = get();
    const cls = selectionGroupClassification(state.blocks, state.selectedKeys);
    switch (cls.kind) {
      case "empty":
      case "single-ungrouped":
        reportGroupToast("Select 2+ blocks to group");
        return;
      case "single-grouped":
      case "all-same-group":
        get().ungroupSelected(cls.groupId);
        return;
      case "all-ungrouped":
        get().groupSelected(state.selectedKeys);
        return;
      case "mixed-grouped-ungrouped":
        reportGroupToast(
          "Selection mixes grouped and ungrouped blocks. Ungroup first or select only ungrouped.",
        );
        return;
      case "multi-group":
        reportGroupToast(
          "Selection spans multiple groups. Ungroup first.",
        );
        return;
    }
  },

  deleteSelected: () =>
    set((state) => {
      if (state.selectedKeys.size === 0 && state.selectedPortPositions.size === 0) return state;
      const entries: Array<{ key: string; block: Block }> = [];
      const removedPipes: Array<{ pos: Position3D; type: PipeType }> = [];
      const seen = new Set<string>();
      let { blocks, hiddenFaces } = { blocks: state.blocks, hiddenFaces: state.hiddenFaces };
      for (const key of state.selectedKeys) {
        if (seen.has(key)) continue;
        const block = blocks.get(key);
        if (!block) continue;
        // Junction-cube cascade: selecting a cube with ≥2 attached pipes also removes
        // those pipes, mirroring single-block removeBlock behaviour.
        const cascadeKeys = !isPipeType(block.type) && countAttachedPipes(block.pos, blocks) >= 2
          ? getAttachedPipeKeys(block.pos, blocks)
          : [];
        entries.push({ key, block });
        if (isPipeType(block.type)) removedPipes.push({ pos: block.pos, type: block.type as PipeType });
        seen.add(key);
        ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, key, block));
        for (const ck of cascadeKeys) {
          if (seen.has(ck)) continue;
          const cb = blocks.get(ck);
          if (!cb) continue;
          entries.push({ key: ck, block: cb });
          if (isPipeType(cb.type)) removedPipes.push({ pos: cb.pos, type: cb.type as PipeType });
          seen.add(ck);
          ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, ck, cb));
        }
      }
      const portKeys: string[] = [];
      const portKeysSet = new Set<string>();
      let portPositions = state.portPositions;
      for (const key of state.selectedPortPositions) {
        if (!portPositions.has(key)) continue;
        if (portKeys.length === 0) portPositions = new Set(portPositions);
        (portPositions as Set<string>).delete(key);
        portKeys.push(key);
        portKeysSet.add(key);
      }
      if (removedPipes.length > 0) {
        const orphaned = orphanedPortKeysFromRemovedPipes(removedPipes, blocks, portPositions);
        for (const k of orphaned) {
          if (portKeysSet.has(k)) continue;
          if (portKeys.length === 0) portPositions = new Set(portPositions);
          (portPositions as Set<string>).delete(k);
          portKeys.push(k);
          portKeysSet.add(k);
        }
      }
      if (entries.length === 0 && portKeys.length === 0) return state;

      const dissolved = applyAutoDissolve(blocks, entries);
      const blocksAfterDissolve = dissolved.blocks;
      const autoDissolvedFor = dissolved.autoDissolvedFor;
      dissolveToast(autoDissolvedFor);

      const cmd: UndoCommand = {
        kind: "bulk-remove",
        entries,
        ...(portKeys.length > 0 ? { portKeys } : {}),
        ...(autoDissolvedFor.length > 0 ? { autoDissolvedFor } : {}),
      };
      const newUndetermined = new Map(state.undeterminedCubes);
      for (const { key } of entries) newUndetermined.delete(key);
      return {
        blocks: blocksAfterDissolve,
        hiddenFaces,
        portPositions,
        history: [...state.history, cmd].slice(-MAX_HISTORY),
        future: [],
        selectedKeys: new Set<string>(),
        selectedPortPositions: new Set<string>(),
        selectionPivot: null,
        hoveredGridPos: null,
        undeterminedCubes: newUndetermined,
      };
    }),

  flipSelected: () =>
    set((state) => {
      if (state.selectedKeys.size === 0) return state;

      const entries: Array<{ key: string; oldBlock: Block; newBlock: Block }> = [];
      for (const key of state.selectedKeys) {
        const block = state.blocks.get(key);
        if (!block) continue;
        const newType = flipBlockType(block.type);
        if (newType === block.type) continue;
        entries.push({ key, oldBlock: block, newBlock: { ...block, type: newType } });
      }
      if (entries.length === 0) return state;

      // Simulated post-flip map for color-conflict checks against non-selected neighbors.
      const proposed = new Map(state.blocks);
      for (const e of entries) proposed.set(e.key, e.newBlock);

      const flipBlocked = "Flip blocked: selection boundary mismatches adjacent colors";
      if (!state.freeBuild) {
        for (const e of entries) {
          const { pos, type } = e.newBlock;
          if (isPipeType(type)) {
            if (hasPipeColorConflict(type, pos, proposed)) {
              return { hoveredInvalidReason: flipBlocked };
            }
          } else if (type !== "Y") {
            if (hasCubeColorConflict(type as CubeType, pos, proposed)) {
              return { hoveredInvalidReason: flipBlocked };
            }
          }
          if (hasYCubePipeAxisConflict(type, pos, proposed)) {
            return { hoveredInvalidReason: flipBlocked };
          }
        }
      }

      let blocks = state.blocks;
      let hiddenFaces = state.hiddenFaces;
      for (const e of entries) {
        ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, e.key, e.oldBlock));
        ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, e.key, e.newBlock));
      }

      const newUndetermined = new Map(state.undeterminedCubes);
      const undeterminedChanges: Array<{ key: string; oldInfo?: UndeterminedCubeInfo; newInfo?: UndeterminedCubeInfo }> = [];
      for (const e of entries) {
        const key = e.key;
        const oldInfo = state.undeterminedCubes.get(key);
        if (oldInfo) {
          newUndetermined.delete(key);
          undeterminedChanges.push({ key, oldInfo, newInfo: undefined });
        }
      }

      const cmd: UndoCommand = { kind: "bulk-replace", entries, undeterminedChanges };
      return {
        blocks,
        hiddenFaces,
        history: [...state.history, cmd].slice(-MAX_HISTORY),
        future: [],
        undeterminedCubes: newUndetermined,
        hoveredInvalidReason: null,
      };
    }),

  rotateSelected: (axis, operation, pivotOverride) => {
    const state = get();
    if (state.selectedKeys.size === 0) return { ok: true };

    // Determine pivot. Priority:
    //   1. Explicit override (user hovered a selected block while pressing the rotate key).
    //   2. Cached selectionPivot from a prior rotation of the same selection AND
    //      same axis. Reusing across axes would inherit a z-coord that wasn't
    //      meaningful for Z-only rotation (and still isn't for X/Y) — recompute
    //      when axis changes.
    //   3. Single-block selection: that block's position, snapped to cube grid.
    //   4. Multi-block selection: bbox center on all 3 axes, snapped to cube grid.
    let pivot: Position3D;
    if (pivotOverride) {
      pivot = {
        x: Math.round(pivotOverride.x / 3) * 3,
        y: Math.round(pivotOverride.y / 3) * 3,
        z: Math.round(pivotOverride.z / 3) * 3,
      };
    } else if (state.selectionPivot && state.selectionPivot.axis === axis) {
      pivot = state.selectionPivot.pos;
    } else if (state.selectedKeys.size === 1) {
      const onlyKey = state.selectedKeys.values().next().value as string;
      const onlyBlock = state.blocks.get(onlyKey);
      if (!onlyBlock) return { ok: true };
      pivot = {
        x: Math.round(onlyBlock.pos.x / 3) * 3,
        y: Math.round(onlyBlock.pos.y / 3) * 3,
        z: Math.round(onlyBlock.pos.z / 3) * 3,
      };
    } else {
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (const key of state.selectedKeys) {
        const block = state.blocks.get(key);
        if (!block) continue;
        if (block.pos.x < minX) minX = block.pos.x;
        if (block.pos.y < minY) minY = block.pos.y;
        if (block.pos.z < minZ) minZ = block.pos.z;
        if (block.pos.x > maxX) maxX = block.pos.x;
        if (block.pos.y > maxY) maxY = block.pos.y;
        if (block.pos.z > maxZ) maxZ = block.pos.z;
      }
      pivot = {
        x: Math.round(((minX + maxX) / 2) / 3) * 3,
        y: Math.round(((minY + maxY) / 2) / 3) * 3,
        z: Math.round(((minZ + maxZ) / 2) / 3) * 3,
      };
    }

    // Build entries; validate grid and collisions before mutating.
    const entries: Array<{ oldKey: string; oldBlock: Block; newKey: string; newBlock: Block }> = [];
    const newKeys = new Set<string>();
    try {
      for (const oldKey of state.selectedKeys) {
        const oldBlock = state.blocks.get(oldKey);
        if (!oldBlock) continue;
        const newBlock = rotateBlockAroundAxis(oldBlock, pivot, axis, operation);
        if (!isValidPos(newBlock.pos, newBlock.type)) {
          return { ok: false, reason: "Result has an invalid grid position" };
        }
        const newKey = posKey(newBlock.pos);
        if (newKeys.has(newKey)) {
          return { ok: false, reason: "Result has overlapping positions" };
        }
        newKeys.add(newKey);
        entries.push({ oldKey, oldBlock, newKey, newBlock });
      }
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : "Operation failed" };
    }

    // Collision: any new key not in the old selection that already has a block
    for (const newKey of newKeys) {
      if (state.selectedKeys.has(newKey)) continue;
      if (state.blocks.has(newKey)) {
        return { ok: false, reason: "Result would overlap an existing block" };
      }
    }

    // Build the post-operation tentative map once for adjacency validation.
    const tentative = new Map(state.blocks);
    for (const entry of entries) tentative.delete(entry.oldKey);
    for (const entry of entries) tentative.set(entry.newKey, entry.newBlock);

    // TQEC validity: cube types must remain compatible with adjacent pipes,
    // and Y blocks must only neighbor Z-open pipes. Skipped under
    // "Ignore color rules" (freeBuild), matching moveSelection and placement
    // paths (GridPlane, BlockInstances, OpenPipeGhosts).
    if (!state.freeBuild) {
      // Cubes to re-validate for color rules: every rotated cube, plus any
      // cube adjacent to a rotated pipe's new position.
      const toCheck = new Map<string, Block>();
      for (const entry of entries) {
        const b = entry.newBlock;
        if (isPipeType(b.type)) {
          const base = b.type.replace("H", "");
          const pipeOpenAxis = base.indexOf("O") as 0 | 1 | 2;
          const nc: [number, number, number] = [b.pos.x, b.pos.y, b.pos.z];
          for (const pipeToCubeOffset of [-1, 2]) {
            nc[pipeOpenAxis] = [b.pos.x, b.pos.y, b.pos.z][pipeOpenAxis] + pipeToCubeOffset;
            const key = posKey({ x: nc[0], y: nc[1], z: nc[2] });
            const neighbor = tentative.get(key);
            if (neighbor && !isPipeType(neighbor.type) && neighbor.type !== "Y") {
              toCheck.set(key, neighbor);
            }
          }
        } else if (b.type !== "Y") {
          toCheck.set(entry.newKey, b);
        }
      }

      for (const cube of toCheck.values()) {
        const opts = determineCubeOptions(cube.pos, tentative);
        const type = cube.type as CubeType;
        const ok = opts.determined ? opts.type === type : opts.options.includes(type);
        if (!ok) {
          return { ok: false, reason: "Color rules between adjacent blocks would break" };
        }
      }

      // Y-block adjacency check: a Y block must only sit next to Z-open pipes.
      // hasYCubePipeAxisConflict is symmetric — passing a Y block checks its
      // pipe neighbors; passing a pipe checks for Y blocks at its endpoints.
      // Iterating over rotated entries catches both directions.
      for (const entry of entries) {
        if (hasYCubePipeAxisConflict(entry.newBlock.type, entry.newBlock.pos, tentative)) {
          return { ok: false, reason: "Y block can only attach to Z-open pipes (top/bottom)" };
        }
      }
    }

    set((s) => {
      let { blocks, hiddenFaces } = { blocks: s.blocks, hiddenFaces: s.hiddenFaces };
      // Remove all old blocks first so collisions on mixed remove/add don't trip
      for (const entry of entries) {
        const existing = blocks.get(entry.oldKey);
        if (existing) {
          ({ blocks, hiddenFaces } = doRemove(blocks, s.spatialIndex, hiddenFaces, entry.oldKey, existing));
        }
      }
      for (const entry of entries) {
        ({ blocks, hiddenFaces } = doAdd(blocks, s.spatialIndex, hiddenFaces, entry.newKey, entry.newBlock));
      }
      // Rotation invalidates undetermined build-mode state for rotated cubes.
      const newUndetermined = new Map(s.undeterminedCubes);
      for (const entry of entries) newUndetermined.delete(entry.oldKey);

      const prevSelectedKeys = Array.from(s.selectedKeys);
      const nextSelectedKeys = entries.map((e) => e.newKey);
      // The "rotate-selection" UndoCommand kind covers any axis and 180° flips —
      // entries[] fully encodes the transformation.
      const cmd: UndoCommand = {
        kind: "rotate-selection",
        entries,
        prevSelectedKeys,
        nextSelectedKeys,
      };
      return {
        blocks,
        hiddenFaces,
        history: [...s.history, cmd].slice(-MAX_HISTORY),
        future: [],
        selectedKeys: new Set(nextSelectedKeys),
        selectionPivot: { pos: pivot, axis },
        hoveredGridPos: null,
        undeterminedCubes: newUndetermined,
      };
    });
    return { ok: true };
  },

  selectAll: () =>
    set((state) => {
      if (state.blocks.size === 0) return state;
      return { selectedKeys: new Set(state.blocks.keys()), selectionPivot: null };
    }),

  selectBlocks: (keys, additive, portKeys) =>
    set((state) => {
      const next = additive ? new Set(state.selectedKeys) : new Set<string>();
      for (const key of keys) {
        if (state.blocks.has(key)) next.add(key);
      }
      const nextPorts = additive ? new Set(state.selectedPortPositions) : new Set<string>();
      if (portKeys) {
        for (const pk of portKeys) nextPorts.add(pk);
      }
      return { selectedKeys: next, selectedPortPositions: nextPorts, selectionPivot: null };
    }),

  setDragState: ({ isDragging, delta, valid }) =>
    set((state) => {
      if (
        state.isDraggingSelection === isDragging &&
        state.dragValid === valid &&
        ((state.dragDelta == null && delta == null) ||
          (state.dragDelta != null && delta != null &&
            state.dragDelta.x === delta.x &&
            state.dragDelta.y === delta.y &&
            state.dragDelta.z === delta.z))
      ) return state;
      return { isDraggingSelection: isDragging, dragDelta: delta, dragValid: valid };
    }),

  moveSelection: (delta) => {
    let succeeded = false;
    set((state) => {
      if (state.selectedKeys.size === 0) return state;
      if (delta.x === 0 && delta.y === 0 && delta.z === 0) return state;

      const entries: Array<{ oldKey: string; oldBlock: Block; newKey: string; newBlock: Block }> = [];
      for (const oldKey of state.selectedKeys) {
        const old = state.blocks.get(oldKey);
        if (!old) continue;
        const newPos: Position3D = { x: old.pos.x + delta.x, y: old.pos.y + delta.y, z: old.pos.z + delta.z };
        if (!isValidPos(newPos, old.type)) return state;
        entries.push({ oldKey, oldBlock: old, newKey: posKey(newPos), newBlock: { ...old, pos: newPos } });
      }
      if (entries.length === 0) return state;

      // Remove all old blocks first so validation sees the reduced map
      let blocks = state.blocks;
      let hiddenFaces = state.hiddenFaces;
      for (const e of entries) {
        ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, e.oldKey, e.oldBlock));
      }

      // Validate each new position against the reduced world
      for (const e of entries) {
        if (hasBlockOverlap(e.newBlock.pos, e.newBlock.type, blocks, state.spatialIndex)) {
          // Rollback: re-add removed blocks, restore spatial index
          for (const r of entries) {
            ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, r.oldKey, r.oldBlock));
          }
          return state;
        }
        if (!state.freeBuild) {
          const t = e.newBlock.type;
          const fails =
            (isPipeType(t) && hasPipeColorConflict(t, e.newBlock.pos, blocks)) ||
            (!isPipeType(t) && t !== "Y" && hasCubeColorConflict(t as CubeType, e.newBlock.pos, blocks)) ||
            hasYCubePipeAxisConflict(t, e.newBlock.pos, blocks);
          if (fails) {
            for (const r of entries) {
              ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, r.oldKey, r.oldBlock));
            }
            return state;
          }
        }
      }

      // Commit: add new blocks
      for (const e of entries) {
        ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, e.newKey, e.newBlock));
      }

      // Transfer undetermined info from old key -> new key
      const newUndetermined = new Map(state.undeterminedCubes);
      for (const e of entries) {
        const info = newUndetermined.get(e.oldKey);
        newUndetermined.delete(e.oldKey);
        if (info) newUndetermined.set(e.newKey, info);
      }

      const newSelected = new Set<string>();
      for (const e of entries) newSelected.add(e.newKey);

      const cmd: UndoCommand = { kind: "bulk-move", entries };
      succeeded = true;
      return {
        blocks,
        hiddenFaces,
        history: [...state.history, cmd].slice(-MAX_HISTORY),
        future: [],
        selectedKeys: newSelected,
        selectionPivot: null,
        hoveredGridPos: null,
        undeterminedCubes: newUndetermined,
      };
    });
    return succeeded;
  },

  // ---------------------------------------------------------------------------
  // Keyboard Build mode actions
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

    // Camera-follow toggle: when off, skip updating cameraSnapTarget and
    // lastBuildAxis so the CameraBuildSnap component never animates.
    const cameraFollowsBuild = useKeybindStore.getState().cameraFollowsBuild;
    const snapUpdate: { cameraSnapTarget?: { azimuth: number | null; targetPos: Position3D }; lastBuildAxis?: number } =
      cameraFollowsBuild
        ? {
            cameraSnapTarget: { azimuth: cameraAzimuthForDirection(direction), targetPos: destPos },
            lastBuildAxis: direction.tqecAxis,
          }
        : {};

    // Slice auto-advance in iso mode: if the build cursor crosses the depth
    // axis, move the visible slice with it so the freshly built cell stays
    // on-screen. Independent of cameraFollowsBuild — without this, building
    // along the depth axis is invisible.
    const sliceUpdate: { viewMode?: ViewMode; lastIsoSlice?: { x: number; y: number; z: number } } = (() => {
      if (state.viewMode.kind !== "iso") return {};
      const axis = state.viewMode.axis;
      const destDepth = axis === "x" ? destPos.x : axis === "y" ? destPos.y : destPos.z;
      if (destDepth === state.viewMode.slice) return {};
      return {
        viewMode: { ...state.viewMode, slice: destDepth },
        lastIsoSlice: { ...state.lastIsoSlice, [axis]: destDepth },
      };
    })();

    const reject = (reason?: string) => {
      if (reason) set({ hoveredInvalidReason: reason });
      return false;
    };

    // If pipe already exists, just move the cursor onto the destination.
    // The destination may be a cube (we land on it) or an open port (cursor
    // sits on the port ghost — the user can extend the build from there).
    const existingPipe = state.blocks.get(pipeKey);
    if (existingPipe) {
      const existingDest = state.blocks.get(destKey);
      if (existingDest && isPipeType(existingDest.type)) return reject();
      set({
        buildCursor: destPos,
        ...snapUpdate,
        ...sliceUpdate,
        hoveredInvalidReason: null,
      });
      return true;
    }

    const srcBlock = state.blocks.get(srcKey);
    const isEmptyOrigin = !srcBlock;
    const isUndetermined = !isEmptyOrigin && state.undeterminedCubes.has(srcKey);

    // Determine source cube type
    let srcType: CubeType;
    let sourceDetermination: BuildStep["sourceDetermination"];
    let sourceRetype: BuildStep["sourceRetype"];

    if (state.freeBuild) {
      // --- Free build: never change existing block/pipe types ---
      if (isEmptyOrigin) {
        const validOrigin = CUBE_TYPES.filter(ct => inferPipeType(ct, direction.tqecAxis) !== null);
        srcType = validOrigin.length > 0 ? validOrigin[0] : CUBE_TYPES[0];
      } else if (srcBlock!.type === "Y" || isPipeType(srcBlock!.type)) {
        return false;
      } else {
        srcType = srcBlock!.type as CubeType;
      }
    } else {
      if (isEmptyOrigin) {
        // Empty origin covers two cases:
        //   (a) first step on an empty canvas — no adjacent pipes, any type works
        //   (b) cursor is sitting on an implicit port (open pipe endpoint) — the
        //       existing pipe(s) constrain which cube types are legal here
        // Use determineCubeOptions to get the constrained candidate set, then
        // pick the first option that can also pipe on the new build direction.
        const opts = determineCubeOptions(cursor, state.blocks);
        const candidates: readonly CubeType[] = opts.determined
          ? [opts.type]
          : opts.options.length > 0
            ? opts.options
            : CUBE_TYPES;
        const validOrigin = candidates.filter(ct => inferPipeType(ct, direction.tqecAxis) !== null);
        if (validOrigin.length === 0) return reject("Cannot build in this direction from here");
        srcType = validOrigin[0];
      } else if (srcBlock!.type === "Y" || isPipeType(srcBlock!.type)) {
        return false;
      } else if (isUndetermined) {
        // Source is undetermined — always commit when building away.
        // Filter to options that can pipe on this axis.
        const info = state.undeterminedCubes.get(srcKey)!;
        const validForDir = info.options.filter(opt => inferPipeType(opt, direction.tqecAxis) !== null);
        if (validForDir.length === 0) return reject("Cannot build in this direction from undetermined cube");

        const currentType = srcBlock!.type as CubeType;
        if (validForDir.includes(currentType)) {
          // The displayed type uniquely determines the pipe — honor it even if
          // other latent options would produce different pipes.
          srcType = currentType;
        } else {
          // Displayed type can't pipe here. Only fall back when remaining options agree.
          const pipeSet = new Set(validForDir.map(opt => inferPipeType(opt, direction.tqecAxis)));
          if (pipeSet.size > 1) return reject("Ambiguous pipe type — cycle with C first");
          srcType = validForDir[0];
        }
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
          // Prefer the candidate that shares the most chars with srcType (least disruptive retype).
          // Ties resolved by candidate order; only ambiguous if tied candidates yield different pipes.
          const ranked = [...validForDir].sort((a, b) => charMatchCount(b, srcType) - charMatchCount(a, srcType));
          const bestScore = charMatchCount(ranked[0], srcType);
          const bestTied = ranked.filter(ct => charMatchCount(ct, srcType) === bestScore);
          const pipeSet = new Set(bestTied.map(ct => inferPipeType(ct, direction.tqecAxis)));
          if (pipeSet.size > 1) return reject("Cube colors don't match — cannot build in this direction");
          sourceRetype = { key: srcKey, prevType: srcType };
          srcType = ranked[0];
        }
      }
    }

    // Infer pipe type from source — in free build mode, fall back to default pipe for axis
    let pipeType = inferPipeType(srcType, direction.tqecAxis);
    if (!pipeType) {
      if (state.freeBuild) {
        pipeType = VARIANT_AXIS_MAP["ZX"][direction.tqecAxis];
      } else {
        return false;
      }
    }

    // Validate pipe position and overlap
    if (!isValidPos(pipePos, pipeType)) return reject("Invalid pipe position");
    if (hasBlockOverlap(pipePos, pipeType, state.blocks, state.spatialIndex)) return reject("Pipe would overlap existing blocks");

    // Y cube pipe axis conflict: Y cubes only work with Z-open pipes
    if (!state.freeBuild && hasYCubePipeAxisConflict(pipeType, pipePos, state.blocks)) return reject("Y blocks only work with Z-open pipes");

    // Check if destination already has a cube
    const existingDest = state.blocks.get(destKey);
    let destTypeChange: BuildStep["destTypeChange"];
    if (existingDest) {
      if (existingDest.type === "Y" || isPipeType(existingDest.type)) return reject();
      if (!state.freeBuild) {
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
          // No valid dest type with current pipe — try Hadamard variant.
          // For positive direction, source is at the head (not swapped by H) so
          // a simple H toggle preserves the source match.
          // For negative direction, source is at the tail (swapped by H) so we
          // need the swapped-base + H variant to keep source colours intact.
          const hPipeType: PipeType = direction.sign > 0
            ? toggleHadamard(pipeType)
            : (swapPipeVariant(pipeType) + "H") as PipeType;

          tmpBlocks.set(pipeKey, { pos: pipePos, type: hPipeType });
          const destOpts2 = determineCubeOptions(destPos, tmpBlocks);
          if (destOpts2.determined) {
            pipeType = hPipeType;
            if (destOpts2.type !== currentDestType) {
              destTypeChange = { key: destKey, prevType: currentDestType, newType: destOpts2.type };
            }
          } else if (destOpts2.options.includes(currentDestType)) {
            pipeType = hPipeType;
          } else if (destOpts2.options.length > 0) {
            pipeType = hPipeType;
            destTypeChange = { key: destKey, prevType: currentDestType, newType: destOpts2.options[0] };
          } else {
            return reject("Cube colors don't match the adjacent pipe");
          }
        }
      }
      // In free build mode: no destTypeChange, no Hadamard switching — keep dest as-is
    } else {
      // Validate destination position and check for overlap with non-cube blocks
      if (!isValidPos(destPos, "XZZ")) return reject("Invalid destination position");
      if (hasBlockOverlap(destPos, "XZZ", state.blocks, state.spatialIndex)) return reject("Destination would overlap existing blocks");

      if (!state.freeBuild) {
        // Pre-check: if existing pipes at destPos conflict with the inferred pipe,
        // try the Hadamard variant (mirrors the existing-dest logic above).
        const tmpBlocks = new Map(state.blocks);
        if (sourceDetermination || isEmptyOrigin) {
          tmpBlocks.set(srcKey, { pos: cursor, type: srcType });
        }
        tmpBlocks.set(pipeKey, { pos: pipePos, type: pipeType });
        const preDestOptions = determineCubeOptions(destPos, tmpBlocks);
        if (!preDestOptions.determined && preDestOptions.options.length === 0) {
          const hPipeType: PipeType = direction.sign > 0
            ? toggleHadamard(pipeType)
            : (swapPipeVariant(pipeType) + "H") as PipeType;
          tmpBlocks.set(pipeKey, { pos: pipePos, type: hPipeType });
          const preDestOptions2 = determineCubeOptions(destPos, tmpBlocks);
          if (preDestOptions2.determined || preDestOptions2.options.length > 0) {
            pipeType = hPipeType;
          }
        }
      }
    }

    // All validation passed — apply mutations
    set((s) => {
      let { blocks, hiddenFaces } = { blocks: s.blocks, hiddenFaces: s.hiddenFaces };
      const newUndetermined = new Map(s.undeterminedCubes);

      // Intentionally do NOT place a cube at an empty origin. The slot stays a
      // port (explicit or implicit at the pipe endpoint). syncPortsAndPromote
      // below will promote it to a canonical cube only if the new pipe pushes
      // its attachment count to ≥2.

      if (!state.freeBuild) {
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

      // Clean up undetermined state for existing destination.
      // A new pipe was explicitly built to this cube, so commit it even
      // when multiple options remain (the user can still cycle with R).
      let destDetermination: BuildStep["destDetermination"];
      if (!state.freeBuild && existingDest && newUndetermined.has(destKey)) {
        destDetermination = { key: destKey, prevUndeterminedInfo: newUndetermined.get(destKey)! };
        newUndetermined.delete(destKey);
      }

      // Handle destination: leave it as an implicit port (open pipe endpoint).
      // The port auto-promotes to a real cube only when a second pipe attaches,
      // via syncPortsAndPromote. If the destination already had a cube, we've
      // already applied any necessary destTypeChange above — nothing to do here.
      const cubeAdded: BuildStep["cube"] = null;
      const destUndetermined: UndeterminedCubeInfo | undefined = undefined;

      // Auto-promote any port endpoint that the new pipe pushed to ≥2 attachments.
      // This is what makes "build into a slot constrained by existing pipes" land on
      // a real cube instead of leaving the cursor on a port.
      let nextPortPositions = s.portPositions;
      let autoPromoted: BuildStep["autoPromoted"];
      const sync = syncPortsAndPromote(blocks, s.spatialIndex, hiddenFaces, s.portPositions);
      if (sync.addedEntries.length > 0) {
        blocks = sync.blocks;
        hiddenFaces = sync.hiddenFaces;
        const promotedSet = new Set(sync.promotedPortKeys);
        autoPromoted = sync.addedEntries.map(e => ({
          key: e.key, block: e.block, wasUserPort: promotedSet.has(e.key),
        }));
        if (sync.promotedPortKeys.length > 0) {
          nextPortPositions = new Set(s.portPositions);
          for (const k of sync.promotedPortKeys) nextPortPositions.delete(k);
        }
      }

      const step: BuildStep = {
        prevCursorPos: cursor,
        destCursorPos: destPos,
        pipe: { key: pipeKey, block: pipeBlock },
        cube: cubeAdded,
        sourceDetermination,
        sourceRetype,
        destUndetermined,
        destTypeChange,
        destDetermination,
        autoPromoted,
      };

      return {
        blocks,
        hiddenFaces,
        buildCursor: destPos,
        buildHistory: [...s.buildHistory, step],
        undeterminedCubes: newUndetermined,
        portPositions: nextPortPositions,
        ...snapUpdate,
        ...sliceUpdate,
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
      let nextPortPositions = s.portPositions;

      // Roll back any auto-promoted cubes first.
      if (step.autoPromoted && step.autoPromoted.length > 0) {
        for (const ap of step.autoPromoted) {
          const cur = blocks.get(ap.key);
          if (cur) ({ blocks, hiddenFaces } = doRemove(blocks, s.spatialIndex, hiddenFaces, ap.key, cur));
          newUndetermined.delete(ap.key);
        }
        const userPortKeys = step.autoPromoted.filter(ap => ap.wasUserPort).map(ap => ap.key);
        if (userPortKeys.length > 0) {
          nextPortPositions = new Set(s.portPositions);
          for (const k of userPortKeys) nextPortPositions.add(k);
        }
      }

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
          ({ blocks, hiddenFaces } = doAdd(blocks, s.spatialIndex, hiddenFaces, dtc.key, { ...curDest, type: dtc.prevType }));
        }
      }

      // Revert dest determination (restore undetermined state)
      if (step.destDetermination) {
        newUndetermined.set(step.destDetermination.key, {
          ...step.destDetermination.prevUndeterminedInfo,
          options: [...step.destDetermination.prevUndeterminedInfo.options],
        });
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

      // Iso: mirror buildMove's slice auto-advance so undo moves the visible
      // slice back with the cursor (otherwise the reverted cursor is off-slab).
      const sliceUpdate: { viewMode?: ViewMode; lastIsoSlice?: { x: number; y: number; z: number } } = (() => {
        if (s.viewMode.kind !== "iso") return {};
        const axis = s.viewMode.axis;
        const p = step.prevCursorPos;
        const destDepth = axis === "x" ? p.x : axis === "y" ? p.y : p.z;
        if (destDepth === s.viewMode.slice) return {};
        return {
          viewMode: { ...s.viewMode, slice: destDepth },
          lastIsoSlice: { ...s.lastIsoSlice, [axis]: destDepth },
        };
      })();

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
          portPositions: nextPortPositions,
          cameraSnapTarget: { azimuth: null, targetPos: step.prevCursorPos },
          lastBuildAxis: null,
          ...sliceUpdate,
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
        portPositions: nextPortPositions,
        cameraSnapTarget: { azimuth: null, targetPos: step.prevCursorPos },
        lastBuildAxis: null,
        ...sliceUpdate,
        hoveredGridPos: null,
      };
    });
  },

  cycleBlock: (target) =>
    set((state) => {
      if (state.mode !== "build" || !state.buildCursor) return state;
      const cursor = state.buildCursor;
      const cursorKey = posKey(cursor);
      const coords: [number, number, number] = [cursor.x, cursor.y, cursor.z];

      // Count adjacent pipes (Y validity uses hasYCubePipeAxisConflict below).
      let pipeCount = 0;
      for (let axis = 0; axis < 3; axis++) {
        for (const pipeOffset of [1, -2]) {
          const nCoords: [number, number, number] = [coords[0], coords[1], coords[2]];
          nCoords[axis] += pipeOffset;
          const n = state.blocks.get(posKey({ x: nCoords[0], y: nCoords[1], z: nCoords[2] }));
          if (n && isPipeType(n.type)) {
            const openAxis = n.type.replace("H", "").indexOf("O");
            if (openAxis === axis) pipeCount++;
          }
        }
      }

      // In free build mode, offer all types unconditionally
      let cubeOptions: (CubeType | "Y")[];
      if (state.freeBuild) {
        cubeOptions = [...CUBE_TYPES, "Y"];
      } else {
        cubeOptions = pipeCount === 0
          ? [...CUBE_TYPES]
          : determineCubeOptionsWithPipeRetype(cursor, state.blocks);
        // Y is a leaf: only valid with at most one attached (Z-open) pipe.
        if (pipeCount <= 1 && !hasYCubePipeAxisConflict("Y", cursor, state.blocks)) cubeOptions.push("Y");
      }
      if (cubeOptions.length === 0) return state;

      // Port (null) is a cycle slot only at positions where it's a stable state
      // (0 or 1 attached pipes). With ≥2 pipes the port would auto-promote, so
      // exclude port from the cycle and offer only real cube options.
      const portAllowed = pipeCount < 2;
      const cycle: (CubeType | "Y" | null)[] = portAllowed
        ? [null, ...cubeOptions]
        : [...cubeOptions];

      const existingBlock = state.blocks.get(cursorKey);
      const existingType: CubeType | "Y" | null = existingBlock && !isPipeType(existingBlock.type)
        ? existingBlock.type as CubeType | "Y" : null;

      let placeType: CubeType | "Y" | null;
      if (target !== undefined) {
        // Explicit target (e.g. toolbar click in Keyboard Build mode) must be a valid option.
        if (!cycle.includes(target)) return state;
        placeType = target;
      } else {
        const currentIdx = cycle.indexOf(existingType);
        const nextIdx = (currentIdx + 1) % cycle.length;
        placeType = cycle[nextIdx];
      }

      // No-op if nothing changes (e.g., no cube options and we'd stay at port).
      if (existingType === placeType) return state;

      let { blocks, hiddenFaces } = { blocks: state.blocks, hiddenFaces: state.hiddenFaces };
      const oldUndetermined = state.undeterminedCubes.get(cursorKey);
      const pipeUpdates: Array<{ key: string; oldType: PipeType; newType: PipeType }> = [];

      // Remove existing cube if present
      if (existingBlock) {
        ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, cursorKey, existingBlock));
      }

      // If cycling to the port slot, there's no new cube to place — the open
      // pipe endpoint (or portPositions marker) will render the port ghost.
      // Spread `existingBlock` when present so groupId rides through the
      // cycle, mirroring edit-mode cycleSelectedType.
      const newBlock: Block | null =
        placeType !== null
          ? (existingBlock
              ? { ...existingBlock, pos: cursor, type: placeType }
              : { pos: cursor, type: placeType })
          : null;
      if (newBlock) {
        ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, cursorKey, newBlock));
      }

      // Update adjacent pipes to match new cube type (skip for Y or port — neither changes pipes)
      // In free build mode, skip pipe retyping entirely — just change the cube
      if (newBlock && placeType !== "Y" && !state.freeBuild) {
        const retypes = computePipeRetypes(blocks, cursor, placeType as CubeType);
        if (retypes === null) {
          // Defense-in-depth: cubeOptions came from determineCubeOptionsWithPipeRetype,
          // so this branch shouldn't fire. Revert spatial-index mutations and bail.
          doRemove(blocks, state.spatialIndex, hiddenFaces, cursorKey, newBlock);
          if (existingBlock) {
            doAdd(blocks, state.spatialIndex, hiddenFaces, cursorKey, existingBlock);
          }
          return state;
        }
        for (const pu of retypes) {
          const pipeBlock = blocks.get(pu.key)!;
          ({ blocks, hiddenFaces } = doRemove(blocks, state.spatialIndex, hiddenFaces, pu.key, pipeBlock));
          ({ blocks, hiddenFaces } = doAdd(blocks, state.spatialIndex, hiddenFaces, pu.key, { ...pipeBlock, type: pu.newType }));
          pipeUpdates.push(pu);
        }
      }

      // Clear any leftover undetermined entry — cycling always commits to a specific state.
      const newUndetermined = new Map(state.undeterminedCubes);
      newUndetermined.delete(cursorKey);

      // Refresh undeterminedCubes for far-end neighbours of retyped pipes
      // (their option set may have narrowed/widened). Mirror the pipe-cycle
      // pattern at line ~1519.
      const undeterminedNeighbors: Array<{ key: string; oldInfo?: UndeterminedCubeInfo; newInfo?: UndeterminedCubeInfo }> = [];
      const seenNeighbors = new Set<string>();
      for (const pu of pipeUpdates) {
        const pipe = blocks.get(pu.key);
        if (!pipe || !isPipeType(pipe.type)) continue;
        const base = pipe.type.replace("H", "");
        const openAxis = base.indexOf("O");
        const pc: [number, number, number] = [pipe.pos.x, pipe.pos.y, pipe.pos.z];
        for (const endOffset of [-1, 2]) {
          const nc: [number, number, number] = [pc[0], pc[1], pc[2]];
          nc[openAxis] += endOffset;
          const nKey = posKey({ x: nc[0], y: nc[1], z: nc[2] });
          if (nKey === cursorKey) continue;
          if (seenNeighbors.has(nKey)) continue;
          seenNeighbors.add(nKey);
          const neighborBlock = blocks.get(nKey);
          if (!neighborBlock || isPipeType(neighborBlock.type) || neighborBlock.type === "Y") continue;
          const oldInfo = state.undeterminedCubes.get(nKey);
          const opts = determineCubeOptions(neighborBlock.pos, blocks);
          let newInfo: UndeterminedCubeInfo | undefined;
          if (opts.determined) {
            newInfo = undefined;
          } else if (opts.options.length > 0) {
            const idx = Math.max(0, opts.options.indexOf(neighborBlock.type as CubeType));
            newInfo = { options: [...opts.options], currentIndex: idx };
          } else {
            newInfo = oldInfo;
          }
          const sameInfo =
            (!oldInfo && !newInfo) ||
            (!!oldInfo && !!newInfo &&
              oldInfo.options.join(",") === newInfo.options.join(",") &&
              oldInfo.currentIndex === newInfo.currentIndex);
          if (sameInfo) continue;
          undeterminedNeighbors.push({ key: nKey, oldInfo, newInfo });
          if (newInfo) newUndetermined.set(nKey, newInfo);
          else newUndetermined.delete(nKey);
        }
      }

      const cmd: UndoCommand = {
        kind: "cube-cycle", cubeKey: cursorKey, cubePos: cursor,
        oldPlacedType: existingType, newPlacedType: placeType,
        oldPipes: pipeUpdates.length > 0 ? pipeUpdates : undefined,
        oldUndetermined, newUndetermined: undefined,
        undeterminedNeighbors: undeterminedNeighbors.length > 0 ? undeterminedNeighbors : undefined,
      };
      return {
        blocks,
        hiddenFaces,
        undeterminedCubes: newUndetermined,
        history: [...state.history, cmd].slice(-MAX_HISTORY),
        future: [],
      };
    }),

  cyclePipe: (target) => {
    const state = get();
    if (state.mode !== "build" || !state.buildCursor) return;

    const cursor = state.buildCursor;
    const cursorCoords: [number, number, number] = [cursor.x, cursor.y, cursor.z];

    // Find adjacent pipes where either end is an "ambiguous" slot whose cube
    // type isn't uniquely fixed (a port, or a multi-option cube). Cycling this
    // pipe means committing the neighbor to a different choice from its options.
    // In free build mode, any adjacent pipe is eligible for cycling.
    const cursorKey = posKey(cursor);
    const isAmbiguousEnd = (key: string): boolean => {
      const b = state.blocks.get(key);
      if (!b) return true;
      if (isPipeType(b.type) || b.type === "Y") return false;
      const opts = determineCubeOptions(b.pos, state.blocks);
      return !opts.determined && opts.options.length > 1;
    };
    const cursorAmbiguous = isAmbiguousEnd(cursorKey);
    const candidatePipes: { key: string; block: Block }[] = [];
    for (let axis = 0; axis < 3; axis++) {
      for (const offset of [1, -2]) {
        const pc: [number, number, number] = [cursorCoords[0], cursorCoords[1], cursorCoords[2]];
        pc[axis] += offset;
        const pk = posKey({ x: pc[0], y: pc[1], z: pc[2] });
        const pipe = state.blocks.get(pk);
        if (!pipe || !isPipeType(pipe.type)) continue;
        const pipeBase = (pipe.type as string).replace("H", "");
        if (pipeBase.indexOf("O") !== axis) continue;
        if (state.freeBuild) {
          candidatePipes.push({ key: pk, block: pipe });
        } else {
          const fc: [number, number, number] = [cursorCoords[0], cursorCoords[1], cursorCoords[2]];
          fc[axis] += offset === 1 ? 3 : -3;
          const farKey = posKey({ x: fc[0], y: fc[1], z: fc[2] });
          if (cursorAmbiguous || isAmbiguousEnd(farKey)) {
            candidatePipes.push({ key: pk, block: pipe });
          }
        }
      }
    }

    if (candidatePipes.length === 0) return;

    // If multiple pipes are eligible, prefer the one the user just walked
    // through. This makes R and toolbar-click "just work" after a step even
    // when the cursor lands next to other colinear or T-junction pipes.
    if (candidatePipes.length > 1) {
      const lastStep = state.buildHistory[state.buildHistory.length - 1];
      if (lastStep) {
        const preferredKey = lastStep.pipe?.key
          ?? traversedPipeKey(lastStep.prevCursorPos, lastStep.destCursorPos);
        const preferred = candidatePipes.find((c) => c.key === preferredKey);
        if (preferred) {
          candidatePipes.length = 0;
          candidatePipes.push(preferred);
        }
      }
    }

    if (!state.freeBuild && candidatePipes.length > 1) {
      set({ hoveredInvalidReason: "Multiple undetermined pipes — cannot cycle" });
      return;
    }

    // In free build mode with multiple pipes, just cycle the first one
    const pipeKey = candidatePipes[0].key;
    const pipeBlock = candidatePipes[0].block;
    if (!isPipeType(pipeBlock.type)) return;

    const oldPipeType = pipeBlock.type as PipeType;
    const oldBase = oldPipeType.replace("H", "");
    const openAxis = oldBase.indexOf("O") as 0 | 1 | 2;
    const pipeCoords: [number, number, number] = [pipeBlock.pos.x, pipeBlock.pos.y, pipeBlock.pos.z];

    // Compute all candidate pipe types for this axis (one per toolbar variant)
    const allCandidates = PIPE_VARIANTS.map(v => VARIANT_AXIS_MAP[v][openAxis]);

    // Filter to valid candidates: both neighbor cubes must have valid options
    // In free build mode, all candidates are valid
    let validPipes: PipeType[];
    if (state.freeBuild) {
      validPipes = allCandidates;
    } else {
      validPipes = [];
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
          // Committed cube neighbours constrain the pipe: the cube's current type
          // must remain a valid option after the candidate pipe is in place.
          const options = determineCubeOptions(neighbor.pos, tmpBlocks);
          const currentType = neighbor.type as CubeType;
          if (options.determined) {
            if (options.type !== currentType) { valid = false; break; }
          } else if (!options.options.includes(currentType)) {
            valid = false; break;
          }
        }
        if (valid) validPipes.push(candidate);
      }
    }

    // Pick the target pipe type — explicit (toolbar click) or next-in-cycle (R key).
    let newPipeType: PipeType;
    if (target !== undefined) {
      const candidate = VARIANT_AXIS_MAP[target][openAxis];
      if (!validPipes.includes(candidate)) return;
      newPipeType = candidate;
    } else {
      if (validPipes.length <= 1) return;
      const currentIdx = validPipes.indexOf(oldPipeType);
      newPipeType = validPipes[(currentIdx + 1) % validPipes.length];
    }
    if (newPipeType === oldPipeType) return;

    // Filter above already guarantees committed neighbour cubes remain valid
    // under newPipeType, so we never retype neighbours here.
    set((s) => {
      let { blocks, hiddenFaces } = { blocks: s.blocks, hiddenFaces: s.hiddenFaces };
      const newUndetermined = new Map(s.undeterminedCubes);

      // Toggle pipe
      ({ blocks, hiddenFaces } = doRemove(blocks, s.spatialIndex, hiddenFaces, pipeKey, pipeBlock));
      // Preserve `groupId` (and any other Block metadata) when toggling pipe type.
      const newPipeBlock: Block = { ...pipeBlock, type: newPipeType };
      ({ blocks, hiddenFaces } = doAdd(blocks, s.spatialIndex, hiddenFaces, pipeKey, newPipeBlock));

      // Refresh undetermined info for the two neighbour cubes (their option set
      // may have shrunk now that the adjacent pipe is committed to a type).
      for (const offset of [-1, 2]) {
        const nCoords: [number, number, number] = [pipeCoords[0], pipeCoords[1], pipeCoords[2]];
        nCoords[openAxis] += offset;
        const nKey = posKey({ x: nCoords[0], y: nCoords[1], z: nCoords[2] });
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

      const cmd: UndoCommand = { kind: "pipe-cycle", pipeKey, oldType: oldPipeType, newType: newPipeType };
      return {
        blocks,
        hiddenFaces,
        undeterminedCubes: newUndetermined,
        history: [...s.history, cmd].slice(-MAX_HISTORY),
        future: [],
      };
    });
  },

  deleteAtBuildCursor: () => {
    const state = get();
    if (state.mode !== "build" || !state.buildCursor) return;
    const key = posKey(state.buildCursor);
    if (!state.blocks.has(key)) return;
    // Delegate to removeBlock for cascade-delete handling and undo bookkeeping.
    // The global Ctrl-Z reverts it; Q (undoBuildStep) does not, by design.
    get().removeBlock(state.buildCursor);
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

  ensurePortLabels: () =>
    set((state) => {
      const positions = getAllPortPositions(state.blocks, state.portPositions);
      const currentKeys = new Set(state.portMeta.keys());
      const newKeys = new Set(positions.map(posKey));

      const missing = positions.filter((p) => !currentKeys.has(posKey(p)));
      const stale = [...currentKeys].filter((k) => !newKeys.has(k));
      if (missing.length === 0 && stale.length === 0) return state;

      const next = new Map(state.portMeta);
      for (const k of stale) next.delete(k);

      const used = new Set<string>();
      let maxRank = -1;
      for (const meta of next.values()) {
        used.add(meta.label);
        if (meta.rank !== undefined && meta.rank > maxRank) maxRank = meta.rank;
      }
      let nextId = 1;
      const allocLabel = (): string => {
        while (used.has(`P${nextId}`)) nextId++;
        const l = `P${nextId}`;
        used.add(l);
        return l;
      };

      for (const pos of missing) {
        maxRank += 1;
        next.set(posKey(pos), {
          label: allocLabel(),
          io: defaultPortIO(pos, state.blocks),
          rank: maxRank,
        });
      }
      return { portMeta: next };
    }),

  setPortLabel: (pos, label) =>
    set((state) => {
      const key = posKey(pos);
      const existing = state.portMeta.get(key);
      if (!existing) return state;
      const trimmed = label.trim();
      if (trimmed === existing.label) return state;

      // Blank input → drop the entry and reallocate a fresh P{n} via the
      // same allocator used for new ports.
      const next = new Map(state.portMeta);
      if (!trimmed) {
        next.delete(key);
        const used = new Set<string>();
        for (const m of next.values()) used.add(m.label);
        let n = 1;
        while (used.has(`P${n}`)) n++;
        next.set(key, { ...existing, label: `P${n}` });
        return { portMeta: next };
      }

      // Reject duplicates (TQEC requires unique port labels).
      for (const [k, m] of state.portMeta) {
        if (k !== key && m.label === trimmed) return state;
      }
      next.set(key, { ...existing, label: trimmed });
      return { portMeta: next };
    }),

  setPortIO: (pos, io) =>
    set((state) => {
      const key = posKey(pos);
      const existing = state.portMeta.get(key);
      if (!existing || existing.io === io) return state;
      const next = new Map(state.portMeta);
      next.set(key, { ...existing, io });
      return { portMeta: next };
    }),

  reorderPort: (fromIndex, toIndex) =>
    set((state) => {
      const ordered = getOrderedPortPositions(
        state.blocks,
        state.portPositions,
        state.portMeta,
      );
      if (
        fromIndex === toIndex ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= ordered.length ||
        toIndex >= ordered.length
      ) {
        return state;
      }
      const keys = ordered.map(posKey);
      const [moved] = keys.splice(fromIndex, 1);
      keys.splice(toIndex, 0, moved);

      const next = new Map(state.portMeta);
      keys.forEach((k, i) => {
        const m = next.get(k);
        if (m && m.rank !== i) next.set(k, { ...m, rank: i });
      });
      return { portMeta: next };
    }),

  setFlowsPanelOpen: (open) =>
    set(open ? { flowsPanelOpen: true } : { flowsPanelOpen: false, flowVizMode: false }),
  toggleFlowsPanel: () =>
    set((s) =>
      s.flowsPanelOpen
        ? { flowsPanelOpen: false, flowVizMode: false }
        : { flowsPanelOpen: true },
    ),

  setFlows: (flows, signature) =>
    set({
      flows,
      flowsSignature: signature,
      selectedFlowIndex: flows.length > 0 ? 0 : null,
    }),
  setSelectedFlowIndex: (index) => set({ selectedFlowIndex: index }),
  setFlowVizMode: (on) => set({ flowVizMode: on }),

  setZXPanelOpen: (open) => set({ zxPanelOpen: open }),
  toggleZXPanel: () => set((s) => ({ zxPanelOpen: !s.zxPanelOpen })),
}));
