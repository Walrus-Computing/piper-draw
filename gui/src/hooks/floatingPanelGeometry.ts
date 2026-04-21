// Pure geometry/persistence helpers for floating panels. Split out from
// useFloatingPanel.tsx so that file exports only the hook + component
// (keeps react-refresh / Fast Refresh happy).

export interface PanelGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Inset (in px) from each window edge that a panel must avoid — typically
 * picked to clear other fixed UI (top toolbar, bottom hint bar / orientation
 * gizmo / help button).
 */
export interface SafeMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const STORAGE_PREFIX = "piperdraw.panel.";

export function panelStorageKey(id: string): string {
  return STORAGE_PREFIX + id;
}

/**
 * Read a panel's last-persisted geometry without mounting the hook.
 * Returns null if nothing has been persisted yet or the stored value is
 * malformed.
 */
export function readPanelGeometry(id: string): PanelGeometry | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(panelStorageKey(id));
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

/**
 * Clamp a panel rectangle to fit inside the window after subtracting `safe`
 * insets. Width/height shrink first (down to `minWidth`/`minHeight`), then x/y
 * shift to keep the rect inside.
 */
export function clampGeometryToSafe(
  g: PanelGeometry,
  safe: SafeMargins,
  minWidth: number,
  minHeight: number,
): PanelGeometry {
  if (typeof window === "undefined") return g;
  const minX = safe.left;
  const minY = safe.top;
  const maxRight = window.innerWidth - safe.right;
  const maxBottom = window.innerHeight - safe.bottom;
  const usableWidth = Math.max(minWidth, maxRight - minX);
  const usableHeight = Math.max(minHeight, maxBottom - minY);
  const width = Math.max(minWidth, Math.min(g.width, usableWidth));
  const height = Math.max(minHeight, Math.min(g.height, usableHeight));
  let x = g.x;
  let y = g.y;
  if (x < minX) x = minX;
  if (x + width > maxRight) x = maxRight - width;
  if (y < minY) y = minY;
  if (y + height > maxBottom) y = maxBottom - height;
  return { x, y, width, height };
}
