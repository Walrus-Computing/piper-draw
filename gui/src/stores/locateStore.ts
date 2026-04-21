import { create } from "zustand";
import { PULSE_SPEED } from "../hooks/usePulseScale";

const PULSE_DURATION_MS = ((2 * 2 * Math.PI) / PULSE_SPEED) * 1000;

interface LocateStore {
  pulseKey: string | null;
  setPulse: (key: string) => void;
  clear: () => void;
}

let timer: ReturnType<typeof setTimeout> | null = null;

export const useLocateStore = create<LocateStore>((set) => ({
  pulseKey: null,
  setPulse: (key) => {
    if (timer) clearTimeout(timer);
    set({ pulseKey: key });
    timer = setTimeout(() => {
      set({ pulseKey: null });
      timer = null;
    }, PULSE_DURATION_MS);
  },
  clear: () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    set({ pulseKey: null });
  },
}));
