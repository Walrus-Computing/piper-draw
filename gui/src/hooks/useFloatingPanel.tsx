import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Persisted geometry for a floating panel (drag-to-move + corner resize).
// Stored under `piperdraw.panel.<id>` in localStorage.
export interface PanelGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FloatingPanelOptions {
  id: string;
  defaultGeometry: PanelGeometry;
  minWidth?: number;
  minHeight?: number;
}

const STORAGE_PREFIX = "piperdraw.panel.";
const KEEP_ON_SCREEN = 40; // px of the panel that must stay inside the viewport

function storageKey(id: string): string {
  return STORAGE_PREFIX + id;
}

function loadGeometry(id: string, fallback: PanelGeometry): PanelGeometry {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(storageKey(id));
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<PanelGeometry>;
    return {
      x: Number.isFinite(parsed.x) ? Number(parsed.x) : fallback.x,
      y: Number.isFinite(parsed.y) ? Number(parsed.y) : fallback.y,
      width: Number.isFinite(parsed.width) ? Number(parsed.width) : fallback.width,
      height: Number.isFinite(parsed.height) ? Number(parsed.height) : fallback.height,
    };
  } catch {
    return fallback;
  }
}

/**
 * Read a panel's last-persisted geometry without mounting the hook.
 * Returns null if nothing has been persisted yet.
 */
export function readPanelGeometry(id: string): PanelGeometry | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(storageKey(id));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PanelGeometry>;
    if (
      !Number.isFinite(parsed.x) ||
      !Number.isFinite(parsed.y) ||
      !Number.isFinite(parsed.width) ||
      !Number.isFinite(parsed.height)
    ) {
      return null;
    }
    return {
      x: Number(parsed.x),
      y: Number(parsed.y),
      width: Number(parsed.width),
      height: Number(parsed.height),
    };
  } catch {
    return null;
  }
}

export function rectsOverlap(a: PanelGeometry, b: PanelGeometry): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function clampPosition(x: number, y: number, w: number, h: number): { x: number; y: number } {
  if (typeof window === "undefined") return { x, y };
  const maxX = window.innerWidth - KEEP_ON_SCREEN;
  const maxY = window.innerHeight - KEEP_ON_SCREEN;
  const minX = -(w - KEEP_ON_SCREEN);
  const minY = 0; // never drag header above the top edge
  return {
    x: Math.min(maxX, Math.max(minX, x)),
    y: Math.min(maxY, Math.max(minY, y)),
  };
}

/**
 * State + handlers for a draggable, resizable, position/size-persisted
 * floating panel. The owning component must:
 *   - apply `containerStyle` (position/size) to its outer fixed-position div,
 *   - spread `dragHandleProps` onto its header (or another drag affordance),
 *   - render `<ResizeGrip {...resizeGripProps} />` inside the panel.
 */
export function useFloatingPanel(opts: FloatingPanelOptions) {
  const { id, defaultGeometry, minWidth = 220, minHeight = 160 } = opts;

  const [geom, setGeom] = useState<PanelGeometry>(() =>
    loadGeometry(id, defaultGeometry),
  );

  // Persist on every change (cheap; geometry is 4 numbers).
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(storageKey(id), JSON.stringify(geom));
  }, [id, geom]);

  // Keep the panel reachable if the window shrinks below its position.
  useEffect(() => {
    const onResize = () => {
      setGeom((g) => {
        const c = clampPosition(g.x, g.y, g.width, g.height);
        return c.x === g.x && c.y === g.y ? g : { ...g, ...c };
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // --- drag (header) ---
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(
    null,
  );
  const onDragPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      // Don't start a drag from interactive controls inside the header.
      const target = e.target as HTMLElement;
      if (target.closest("button, input, select, textarea, a")) return;
      e.preventDefault();
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origX: geom.x,
        origY: geom.y,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [geom.x, geom.y],
  );
  const onDragPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d) return;
    setGeom((g) => {
      const next = clampPosition(
        d.origX + (e.clientX - d.startX),
        d.origY + (e.clientY - d.startY),
        g.width,
        g.height,
      );
      return { ...g, ...next };
    });
  }, []);
  const onDragPointerUp = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  // --- resize (bottom-right grip) ---
  const resizeRef = useRef<{
    startX: number;
    startY: number;
    origW: number;
    origH: number;
  } | null>(null);
  const onResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      e.preventDefault();
      e.stopPropagation();
      resizeRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origW: geom.width,
        origH: geom.height,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [geom.width, geom.height],
  );
  const onResizePointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const r = resizeRef.current;
      if (!r) return;
      const w = Math.max(minWidth, r.origW + (e.clientX - r.startX));
      const h = Math.max(minHeight, r.origH + (e.clientY - r.startY));
      setGeom((g) => ({ ...g, width: w, height: h }));
    },
    [minWidth, minHeight],
  );
  const onResizePointerUp = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (!resizeRef.current) return;
    resizeRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  const containerStyle = useMemo<React.CSSProperties>(
    () => ({
      position: "fixed",
      left: geom.x,
      top: geom.y,
      width: geom.width,
      height: geom.height,
    }),
    [geom],
  );

  const dragHandleProps = useMemo(
    () => ({
      onPointerDown: onDragPointerDown,
      onPointerMove: onDragPointerMove,
      onPointerUp: onDragPointerUp,
      onPointerCancel: onDragPointerUp,
      style: { cursor: "move", touchAction: "none" } as React.CSSProperties,
    }),
    [onDragPointerDown, onDragPointerMove, onDragPointerUp],
  );

  const resizeGripProps = useMemo(
    () => ({
      onPointerDown: onResizePointerDown,
      onPointerMove: onResizePointerMove,
      onPointerUp: onResizePointerUp,
      onPointerCancel: onResizePointerUp,
    }),
    [onResizePointerDown, onResizePointerMove, onResizePointerUp],
  );

  const setGeometry = useCallback(
    (patch: Partial<PanelGeometry>) => {
      setGeom((g) => {
        const width = Math.max(minWidth, patch.width ?? g.width);
        const height = Math.max(minHeight, patch.height ?? g.height);
        const pos = clampPosition(patch.x ?? g.x, patch.y ?? g.y, width, height);
        return { x: pos.x, y: pos.y, width, height };
      });
    },
    [minWidth, minHeight],
  );

  return { containerStyle, dragHandleProps, resizeGripProps, geometry: geom, setGeometry };
}

export function ResizeGrip(props: {
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (e: React.PointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      role="separator"
      aria-label="Resize panel"
      title="Drag to resize"
      {...props}
      style={{
        position: "absolute",
        right: 0,
        bottom: 0,
        width: 14,
        height: 14,
        cursor: "nwse-resize",
        touchAction: "none",
        backgroundImage:
          "linear-gradient(135deg, transparent 0 6px, #999 6px 7px, transparent 7px 10px, #999 10px 11px, transparent 11px)",
        borderBottomRightRadius: 8,
        zIndex: 1,
      }}
    />
  );
}
