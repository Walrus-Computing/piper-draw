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

  validate: () => Promise<void>;
  dismiss: () => void;
}

let requestVersion = 0;

export const useValidationStore = create<ValidationStore>((set, get) => ({
  status: "idle",
  errors: [],
  invalidKeys: new Set(),

  validate: async () => {
    const version = ++requestVersion;
    set({ status: "loading", errors: [], invalidKeys: new Set() });

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
    set({ status: "idle", errors: [], invalidKeys: new Set() });
  },
}));

// Auto-dismiss validation when the diagram changes
let prevBlocks = useBlockStore.getState().blocks;
useBlockStore.subscribe((s) => {
  if (s.blocks !== prevBlocks) {
    prevBlocks = s.blocks;
    useValidationStore.getState().dismiss();
  }
});
