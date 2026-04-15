import { create } from "zustand";
import type { Position3D } from "../types";
import { posKey } from "../types";
import { useBlockStore } from "./blockStore";
import { validateDiagram } from "../utils/validate";

export type ValidationStatus = "idle" | "loading" | "valid" | "invalid" | "error";

export interface ValidationError {
  position: Position3D;
  message: string;
}

interface ValidationStore {
  status: ValidationStatus;
  errors: ValidationError[];
  invalidKeys: Set<string>;
  /** posKey of the currently focused error (pulsing highlight) */
  selectedErrorKey: string | null;

  validate: () => Promise<void>;
  dismiss: () => void;
  dismissError: (index: number) => void;
  selectError: (key: string | null) => void;
}

let requestVersion = 0;

export const useValidationStore = create<ValidationStore>((set, get) => ({
  status: "idle",
  errors: [],
  invalidKeys: new Set(),
  selectedErrorKey: null,

  validate: async () => {
    const version = ++requestVersion;
    set({ status: "loading", errors: [], invalidKeys: new Set(), selectedErrorKey: null });

    const blocks = useBlockStore.getState().blocks;
    const result = await validateDiagram(blocks);

    // Ignore result if a newer request was started
    if (version !== requestVersion) return;

    if (result.valid) {
      set({ status: "valid", errors: [], invalidKeys: new Set() });
    } else {
      const errors: ValidationError[] = result.errors
        .filter((e) => e.position !== null)
        .map((e) => ({
          position: { x: e.position![0], y: e.position![1], z: e.position![2] },
          message: e.message,
        }));
      // Include position-less errors as messages only
      const globalErrors: ValidationError[] = result.errors
        .filter((e) => e.position === null)
        .map((e) => ({ position: { x: NaN, y: NaN, z: NaN }, message: e.message }));
      const allErrors = [...errors, ...globalErrors];
      const keys = new Set(errors.map((e) => posKey(e.position)));
      set({ status: "invalid", errors: allErrors, invalidKeys: keys });
    }
  },

  dismiss: () => {
    if (get().status === "idle") return;
    set({ status: "idle", errors: [], invalidKeys: new Set(), selectedErrorKey: null });
  },

  dismissError: (index) => {
    const { errors, selectedErrorKey } = get();
    const removed = errors[index];
    const remaining = errors.filter((_, i) => i !== index);
    if (remaining.length === 0) {
      set({ status: "idle", errors: [], invalidKeys: new Set(), selectedErrorKey: null });
      return;
    }
    const remainingKeys = new Set(
      remaining.filter((e) => !isNaN(e.position.x)).map((e) => posKey(e.position)),
    );
    const clearedKey = removed && !isNaN(removed.position.x) ? posKey(removed.position) : null;
    set({
      errors: remaining,
      invalidKeys: remainingKeys,
      selectedErrorKey: selectedErrorKey === clearedKey ? null : selectedErrorKey,
    });
  },

  selectError: (key) => set({ selectedErrorKey: key }),
}));

// ---------------------------------------------------------------------------
// Smart per-position error removal when blocks change
// ---------------------------------------------------------------------------

// Neighbor offsets covering only directly adjacent pipes (+/-1, +/-2) but NOT the
// next cube (+/-3). A cube's error should only clear when that cube itself or its
// own adjacent pipes change, not when a cube on the other side of a pipe changes.
const NEIGHBOR_OFFSETS: [number, number, number][] = [];
for (let axis = 0; axis < 3; axis++) {
  for (const dist of [-2, -1, 1, 2]) {
    const offset: [number, number, number] = [0, 0, 0];
    offset[axis] = dist;
    NEIGHBOR_OFFSETS.push([...offset]);
  }
}

function parseKey(key: string): Position3D | null {
  const parts = key.split(",");
  if (parts.length !== 3) return null;
  const [x, y, z] = parts.map(Number);
  if (isNaN(x) || isNaN(y) || isNaN(z)) return null;
  return { x, y, z };
}

let prevBlocks = useBlockStore.getState().blocks;
useBlockStore.subscribe((s) => {
  if (s.blocks === prevBlocks) return;
  const oldBlocks = prevBlocks;
  prevBlocks = s.blocks;

  const store = useValidationStore.getState();
  if (store.status === "idle" || store.status === "loading") return;

  // For non-invalid statuses (valid, error), dismiss on any change
  if (store.status !== "invalid" || store.invalidKeys.size === 0) {
    useValidationStore.getState().dismiss();
    return;
  }

  // Find which posKeys changed (added, removed, or type changed)
  const changedKeys = new Set<string>();
  for (const [key, block] of s.blocks) {
    const old = oldBlocks.get(key);
    if (!old || old.type !== block.type) {
      changedKeys.add(key);
    }
  }
  for (const key of oldBlocks.keys()) {
    if (!s.blocks.has(key)) {
      changedKeys.add(key);
    }
  }
  if (changedKeys.size === 0) return;

  // Build affected set: changed keys + their neighbors
  const affectedKeys = new Set<string>();
  for (const key of changedKeys) {
    affectedKeys.add(key);
    const pos = parseKey(key);
    if (pos) {
      for (const [dx, dy, dz] of NEIGHBOR_OFFSETS) {
        affectedKeys.add(posKey({ x: pos.x + dx, y: pos.y + dy, z: pos.z + dz }));
      }
    }
  }

  // Remove only errors whose positions are in the affected set
  const remainingErrors = store.errors.filter(
    (e) => isNaN(e.position.x) || !affectedKeys.has(posKey(e.position)),
  );
  const remainingKeys = new Set(
    remainingErrors.filter((e) => !isNaN(e.position.x)).map((e) => posKey(e.position)),
  );

  if (remainingKeys.size === 0 && remainingErrors.every((e) => isNaN(e.position.x))) {
    useValidationStore.setState({ status: "idle", errors: [], invalidKeys: new Set() });
  } else {
    useValidationStore.setState({ errors: remainingErrors, invalidKeys: remainingKeys });
  }
});
