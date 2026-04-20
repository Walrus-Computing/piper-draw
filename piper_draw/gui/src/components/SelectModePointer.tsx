import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { useBlockStore } from "../stores/blockStore";
import { getBlockKeysInScreenRect } from "../utils/projection";
import { pointerGroundPoint } from "../utils/groundPlane";
import { isMoveValid } from "../utils/dragValidate";
import { blockThreeSize, tqecToThree, yBlockZOffset } from "../types";
import type { Block, Position3D } from "../types";

/** Minimum drag distance (px) before a gesture commits to marquee or drag. */
const DRAG_THRESHOLD = 5;

/** Pixels of vertical pointer travel per TQEC unit when Shift-drag is active. */
const PX_PER_TQEC_Z = 25; // 75 px ≈ 3 TQEC units = one grid step

export interface ThreeState {
  camera: THREE.Camera;
  size: { width: number; height: number };
}

type Pending = {
  kind: "pending";
  pointerId: number;
  target: HTMLElement;
  canvasRect: DOMRect;
  startX: number;
  startY: number;
  hitBlockKey: string | null;
  shiftAtDown: boolean;
};

type DraggingMarquee = {
  kind: "marquee";
  pointerId: number;
  target: HTMLElement;
  canvasRect: DOMRect;
  startX: number;
  startY: number;
};

type DraggingSelection = {
  kind: "selection";
  pointerId: number;
  target: HTMLElement;
  canvasRect: DOMRect;
  startX: number;
  startY: number;
  vertical: boolean;
  /** Three.js-y of the plane we raycast against for horizontal drags (= TQEC z of hit block). */
  planeY: number;
  /** TQEC-space start point of the pointer projected onto the drag plane (horizontal mode). */
  startTqec: { x: number; y: number } | null;
  /** Accumulated z-nudge from ArrowUp/ArrowDown during the gesture, in TQEC units (multiples of 3). */
  zOffset: number;
  lastValidDelta: Position3D;
};

type DragState = Pending | DraggingMarquee | DraggingSelection | null;

// Module-level allocations reused each frame
const _raycaster = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _box = new THREE.Box3();
const _boxMin = new THREE.Vector3();
const _boxMax = new THREE.Vector3();
const _hit = new THREE.Vector3();
const _worldPoint = new THREE.Vector3();

function pickSelectedBlockAt(
  camera: THREE.Camera,
  ndcX: number,
  ndcY: number,
  selectedKeys: Set<string>,
  blocks: Map<string, Block>,
): string | null {
  if (selectedKeys.size === 0) return null;
  _ndc.set(ndcX, ndcY);
  _raycaster.setFromCamera(_ndc, camera);
  let bestKey: string | null = null;
  let bestT = Infinity;
  for (const key of selectedKeys) {
    const block = blocks.get(key);
    if (!block) continue;
    const zo = block.type === "Y" ? yBlockZOffset(block.pos, blocks) : 0;
    const [cx, cy, cz] = tqecToThree(block.pos, block.type, zo);
    const [sx, sy, sz] = blockThreeSize(block.type);
    _boxMin.set(cx - sx / 2, cy - sy / 2, cz - sz / 2);
    _boxMax.set(cx + sx / 2, cy + sy / 2, cz + sz / 2);
    _box.set(_boxMin, _boxMax);
    const hit = _raycaster.ray.intersectBox(_box, _hit);
    if (!hit) continue;
    const t = _hit.distanceToSquared(_raycaster.ray.origin);
    if (t < bestT) {
      bestT = t;
      bestKey = key;
    }
  }
  return bestKey;
}

function snap3(v: number): number {
  return Math.round(v / 3) * 3;
}

export function SelectModePointer({
  threeStateRef,
  controlsRef,
}: {
  threeStateRef: React.RefObject<ThreeState | null>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  controlsRef: React.RefObject<any>;
}) {
  const mode = useBlockStore((s) => s.mode);

  const dragRef = useRef<DragState>(null);
  const rafRef = useRef<number | null>(null);
  const latestEventRef = useRef<{ clientX: number; clientY: number; shiftKey: boolean } | null>(null);

  const [marqueeRect, setMarqueeRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const cancelDrag = useCallback(() => {
    const state = dragRef.current;
    if (!state) return;
    try {
      state.target.releasePointerCapture(state.pointerId);
    } catch {
      // capture may have been released already
    }
    if (state.kind === "selection") {
      useBlockStore.getState().setDragState({ isDragging: false, delta: null, valid: true });
    }
    if (controlsRef.current) {
      controlsRef.current.enableRotate = true;
      controlsRef.current.enablePan = true;
    }
    dragRef.current = null;
    setMarqueeRect(null);
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, [controlsRef]);

  const updateDragFromLatest = useCallback(() => {
    rafRef.current = null;
    const state = dragRef.current;
    const latest = latestEventRef.current;
    if (!state || state.kind !== "selection" || !latest) return;

    const store = useBlockStore.getState();
    const ts = threeStateRef.current;
    if (!ts) return;

    let delta: Position3D;
    if (state.vertical) {
      const dy = latest.clientY - state.startY;
      // Upward drag = +z (temporal up). Snap to multiples of 3.
      const rawZ = -dy / PX_PER_TQEC_Z;
      delta = { x: 0, y: 0, z: snap3(rawZ) };
    } else {
      // Horizontal: raycast pointer onto the plane at the hit block's elevation
      const ndcX = ((latest.clientX - state.canvasRect.left) / state.canvasRect.width) * 2 - 1;
      const ndcY = 1 - ((latest.clientY - state.canvasRect.top) / state.canvasRect.height) * 2;
      const ok = pointerGroundPoint(ts.camera, ndcX, ndcY, _worldPoint, state.planeY);
      if (!ok || !state.startTqec) {
        // Reuse last valid delta (don't update); ghost keeps its last pose
        return;
      }
      const curTqecX = _worldPoint.x;
      const curTqecY = -_worldPoint.z;
      const rawX = curTqecX - state.startTqec.x;
      const rawY = curTqecY - state.startTqec.y;
      delta = { x: snap3(rawX), y: snap3(rawY), z: 0 };
    }

    if (state.zOffset !== 0) {
      delta = { x: delta.x, y: delta.y, z: delta.z + state.zOffset };
    }

    const valid = isMoveValid(
      {
        blocks: store.blocks,
        selectedKeys: store.selectedKeys,
        freeBuild: store.freeBuild,
      },
      delta,
    );

    if (valid) {
      state.lastValidDelta = delta;
    }
    useBlockStore.getState().setDragState({ isDragging: true, delta, valid });
  }, [threeStateRef]);

  const scheduleFrame = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(updateDragFromLatest);
  }, [updateDragFromLatest]);

  const onPointerDown = useCallback(
    (e: PointerEvent) => {
      if (mode !== "select") return;
      if (e.button !== 0) return;
      if (e.altKey) return;
      const target = e.target as HTMLElement;
      if (!target || target.tagName !== "CANVAS") return;
      if (dragRef.current != null) return;

      const canvasRect = target.getBoundingClientRect();
      const ts = threeStateRef.current;
      let hitKey: string | null = null;
      if (ts) {
        const ndcX = ((e.clientX - canvasRect.left) / canvasRect.width) * 2 - 1;
        const ndcY = 1 - ((e.clientY - canvasRect.top) / canvasRect.height) * 2;
        const store = useBlockStore.getState();
        hitKey = pickSelectedBlockAt(ts.camera, ndcX, ndcY, store.selectedKeys, store.blocks);
      }

      dragRef.current = {
        kind: "pending",
        pointerId: e.pointerId,
        target,
        canvasRect,
        startX: e.clientX,
        startY: e.clientY,
        hitBlockKey: hitKey,
        shiftAtDown: e.shiftKey,
      };
      try {
        target.setPointerCapture(e.pointerId);
      } catch {
        // Some browsers reject capture during certain input phases
      }
    },
    [mode, threeStateRef],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const state = dragRef.current;
      if (!state) return;

      if (state.kind === "pending") {
        const dx = e.clientX - state.startX;
        const dy = e.clientY - state.startY;
        if (Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;

        if (state.hitBlockKey) {
          // Commit to drag-selection. Horizontal drags project onto a plane at
          // the hit block's elevation so selections with TQEC z>0 track correctly.
          const ts = threeStateRef.current;
          const store = useBlockStore.getState();
          const hitBlock = store.blocks.get(state.hitBlockKey);
          let planeY = 0;
          if (hitBlock) {
            const zo = hitBlock.type === "Y" ? yBlockZOffset(hitBlock.pos, store.blocks) : 0;
            planeY = tqecToThree(hitBlock.pos, hitBlock.type, zo)[1];
          }
          let startTqec: { x: number; y: number } | null = null;
          if (ts && !state.shiftAtDown) {
            const ndcX = ((state.startX - state.canvasRect.left) / state.canvasRect.width) * 2 - 1;
            const ndcY = 1 - ((state.startY - state.canvasRect.top) / state.canvasRect.height) * 2;
            const ok = pointerGroundPoint(ts.camera, ndcX, ndcY, _worldPoint, planeY);
            if (ok) startTqec = { x: _worldPoint.x, y: -_worldPoint.z };
          }
          const next: DraggingSelection = {
            kind: "selection",
            pointerId: state.pointerId,
            target: state.target,
            canvasRect: state.canvasRect,
            startX: state.startX,
            startY: state.startY,
            vertical: state.shiftAtDown,
            planeY,
            startTqec,
            zOffset: 0,
            lastValidDelta: { x: 0, y: 0, z: 0 },
          };
          dragRef.current = next;
          if (controlsRef.current) {
            controlsRef.current.enableRotate = false;
            controlsRef.current.enablePan = false;
          }
          useBlockStore.getState().setDragState({ isDragging: true, delta: { x: 0, y: 0, z: 0 }, valid: true });
          latestEventRef.current = { clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey };
          scheduleFrame();
          return;
        }

        // Commit to marquee
        const next: DraggingMarquee = {
          kind: "marquee",
          pointerId: state.pointerId,
          target: state.target,
          canvasRect: state.canvasRect,
          startX: state.startX,
          startY: state.startY,
        };
        dragRef.current = next;
        if (controlsRef.current) {
          controlsRef.current.enableRotate = false;
        }
        // Fall through to render first rectangle
        const x = Math.min(e.clientX, next.startX);
        const y = Math.min(e.clientY, next.startY);
        setMarqueeRect({ x, y, w: Math.abs(dx), h: Math.abs(dy) });
        return;
      }

      if (state.kind === "marquee") {
        const dx = e.clientX - state.startX;
        const dy = e.clientY - state.startY;
        const x = Math.min(e.clientX, state.startX);
        const y = Math.min(e.clientY, state.startY);
        setMarqueeRect({ x, y, w: Math.abs(dx), h: Math.abs(dy) });
        return;
      }

      if (state.kind === "selection") {
        latestEventRef.current = { clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey };
        scheduleFrame();
      }
    },
    [threeStateRef, controlsRef, scheduleFrame],
  );

  const onPointerUp = useCallback(
    (e: PointerEvent) => {
      const state = dragRef.current;
      if (!state) return;

      try {
        state.target.releasePointerCapture(state.pointerId);
      } catch {
        // already released
      }
      if (controlsRef.current) {
        controlsRef.current.enableRotate = true;
        controlsRef.current.enablePan = true;
      }

      if (state.kind === "pending") {
        // Below threshold — r3f onClick on blocks will handle selection toggle.
        dragRef.current = null;
        return;
      }

      if (state.kind === "marquee") {
        setMarqueeRect(null);
        dragRef.current = null;
        if (useBlockStore.getState().mode !== "select") return;

        const ts = threeStateRef.current;
        if (!ts) return;
        const canvasRect = state.target.getBoundingClientRect();
        const screenRect = {
          x1: Math.min(e.clientX, state.startX) - canvasRect.left,
          y1: Math.min(e.clientY, state.startY) - canvasRect.top,
          x2: Math.max(e.clientX, state.startX) - canvasRect.left,
          y2: Math.max(e.clientY, state.startY) - canvasRect.top,
        };
        const blocks = useBlockStore.getState().blocks;
        const keys = getBlockKeysInScreenRect(
          blocks,
          ts.camera,
          canvasRect.width,
          canvasRect.height,
          screenRect,
        );
        useBlockStore.getState().selectBlocks(keys, e.shiftKey);
        return;
      }

      // selection drag
      const commitDelta = state.lastValidDelta;
      dragRef.current = null;
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      useBlockStore.getState().setDragState({ isDragging: false, delta: null, valid: true });
      if (commitDelta.x !== 0 || commitDelta.y !== 0 || commitDelta.z !== 0) {
        useBlockStore.getState().moveSelection(commitDelta);
      }
    },
    [controlsRef, threeStateRef],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const state = dragRef.current;
      if (e.key === "Escape" && state != null) {
        e.preventDefault();
        // stopImmediatePropagation prevents App.tsx's keydown handler
        // (same target) from also running clearSelection.
        e.stopImmediatePropagation();
        cancelDrag();
        return;
      }
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;

      if (state?.kind === "selection") {
        e.preventDefault();
        e.stopImmediatePropagation();
        state.zOffset += e.key === "ArrowUp" ? 3 : -3;
        scheduleFrame();
        return;
      }

      // Standalone nudge: no active drag, but a selection exists → move it by ±3 in z.
      if (mode !== "select") return;
      const store = useBlockStore.getState();
      if (store.selectedKeys.size === 0) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      store.moveSelection({ x: 0, y: 0, z: e.key === "ArrowUp" ? 3 : -3 });
    },
    [cancelDrag, mode, scheduleFrame],
  );

  const onBlur = useCallback(() => {
    if (dragRef.current != null) cancelDrag();
  }, [cancelDrag]);

  useEffect(() => {
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [onPointerDown, onPointerMove, onPointerUp, onKeyDown, onBlur]);

  // Cancel in-flight drag when mode changes away from select. Subscribing to
  // the store directly (instead of watching `mode` in a deps array) avoids the
  // set-state-in-effect cascading-render lint warning.
  useEffect(() => {
    return useBlockStore.subscribe((state, prev) => {
      if (prev.mode === "select" && state.mode !== "select" && dragRef.current != null) {
        cancelDrag();
      }
    });
  }, [cancelDrag]);

  if (!marqueeRect) return null;

  return (
    <div
      style={{
        position: "fixed",
        left: marqueeRect.x,
        top: marqueeRect.y,
        width: marqueeRect.w,
        height: marqueeRect.h,
        border: "1px solid #4a9eff",
        background: "rgba(74, 158, 255, 0.1)",
        pointerEvents: "none",
        zIndex: 10,
      }}
    />
  );
}
