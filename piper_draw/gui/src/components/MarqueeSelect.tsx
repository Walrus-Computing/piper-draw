import { useCallback, useEffect, useRef, useState } from "react";
import type * as THREE from "three";
import { useBlockStore } from "../stores/blockStore";
import { getBlockKeysInScreenRect } from "../utils/projection";

/** Minimum drag distance (px) before showing the marquee rectangle. */
const DRAG_THRESHOLD = 5;

export interface ThreeState {
  camera: THREE.Camera;
  size: { width: number; height: number };
}

export function MarqueeSelect({
  threeStateRef,
}: {
  threeStateRef: React.RefObject<ThreeState | null>;
}) {
  const mode = useBlockStore((s) => s.mode);

  const dragRef = useRef<{
    startX: number;
    startY: number;
    canvasRect: DOMRect;
    pointerId: number;
    target: HTMLElement;
  } | null>(null);

  const [rect, setRect] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);

  const onPointerDown = useCallback(
    (e: PointerEvent) => {
      if (mode !== "select") return;
      if (e.button !== 0) return;
      // Only start on the canvas element itself
      const target = e.target as HTMLElement;
      if (target.tagName !== "CANVAS") return;

      const canvasRect = target.getBoundingClientRect();
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        canvasRect,
        pointerId: e.pointerId,
        target,
      };
      target.setPointerCapture(e.pointerId);
    },
    [mode],
  );

  const onPointerMove = useCallback((e: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;

    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;

    const x = Math.min(e.clientX, drag.startX);
    const y = Math.min(e.clientY, drag.startY);
    setRect({ x, y, w: Math.abs(dx), h: Math.abs(dy) });
  }, []);

  const onPointerUp = useCallback(
    (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;

      drag.target.releasePointerCapture(drag.pointerId);

      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;

      setRect(null);

      // Only trigger marquee if drag exceeded threshold
      if (Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;

      const ts = threeStateRef.current;
      if (!ts) return;

      const { canvasRect } = drag;
      const screenRect = {
        x1: Math.min(e.clientX, drag.startX) - canvasRect.left,
        y1: Math.min(e.clientY, drag.startY) - canvasRect.top,
        x2: Math.max(e.clientX, drag.startX) - canvasRect.left,
        y2: Math.max(e.clientY, drag.startY) - canvasRect.top,
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
    },
    [threeStateRef],
  );

  useEffect(() => {
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [onPointerDown, onPointerMove, onPointerUp]);

  if (!rect) return null;

  return (
    <div
      style={{
        position: "fixed",
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        border: "1px solid #4a9eff",
        background: "rgba(74, 158, 255, 0.1)",
        pointerEvents: "none",
        zIndex: 10,
      }}
    />
  );
}
