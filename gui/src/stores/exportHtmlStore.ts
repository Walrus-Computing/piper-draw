import { create } from "zustand";

// Open-state for the Export HTML modal. Kept in its own focused store so the
// trigger (a button in the Export dropdown, which unmounts on close) stays
// decoupled from the modal (mounted stably in BgraphDialogs).
interface ExportHtmlStore {
  open: boolean;
  openModal: () => void;
  close: () => void;
}

export const useExportHtmlStore = create<ExportHtmlStore>((set) => ({
  open: false,
  openModal: () => set({ open: true }),
  close: () => set({ open: false }),
}));
