import { isPipeType } from "../types";
import type { Block } from "../types";

/**
 * Interactive tutorial: step definitions and the pure snapshot/predicate layer.
 *
 * Modeled on the neutral-atom editor's click-through tour (ft-neutral-atom-circuits
 * src/tutorial.ts): every step is a real edit on the live document, and
 * completion is detected by comparing document totals against a per-step
 * baseline — never by trusting a "Next" click. The stateful controller lives
 * in stores/tutorialStore.ts; everything here is pure so it can be unit-tested
 * without the store (utils/ must not import stores/).
 */

/** Monotonic action tallies the tutorial store derives from live events
 * (undo-history kinds and validationStore's status stream). Kept OUT of the
 * capped undo history: tallying `history` directly would pin counts once the
 * 100-entry window saturates with the counted kind, stranding a step. */
export type TutorialActionCounters = {
  typeCycles: number;
  buildSteps: number;
  sceneLoads: number;
  bulkAdds: number;
  portAdds: number;
  verifyRuns: number;
};

export const ZERO_ACTION_COUNTERS: TutorialActionCounters = {
  typeCycles: 0,
  buildSteps: 0,
  sceneLoads: 0,
  bulkAdds: 0,
  portAdds: 0,
  verifyRuns: 0,
};

/** Undo-command kind → the action counter it increments (when newly pushed). */
export function counterKeyForHistoryKind(kind: string): keyof TutorialActionCounters | null {
  switch (kind) {
    case "edit-type-cycle": return "typeCycles";
    case "build-step": return "buildSteps";
    case "load": return "sceneLoads";
    case "bulk-add": return "bulkAdds";
    case "add-port":
    case "port": return "portAdds";
    default: return null;
  }
}

/** Document totals the tutorial compares against a per-step baseline. */
export type TutorialSnapshot = TutorialActionCounters & {
  cubes: number;
  pipes: number;
  /** Explicit port markers (portPositions), not implicit dangling ends. */
  ports: number;
  blocks: number;
  selected: number;
  mode: "edit" | "build";
  flowsOpen: boolean;
  zxOpen: boolean;
};

/** The slice of blockStore state the snapshot is derived from (structural, so
 * tests can pass a plain object). */
export interface TutorialSnapshotSource {
  blocks: Map<string, Block>;
  portPositions: Set<string>;
  selectedKeys: Set<string>;
  mode: "edit" | "build";
  flowsPanelOpen: boolean;
  zxPanelOpen: boolean;
}

export function buildTutorialSnapshot(
  state: TutorialSnapshotSource,
  counters: TutorialActionCounters,
): TutorialSnapshot {
  let cubes = 0;
  let pipes = 0;
  for (const b of state.blocks.values()) {
    if (isPipeType(b.type)) pipes++;
    else cubes++;
  }
  return {
    ...counters,
    cubes,
    pipes,
    ports: state.portPositions.size,
    blocks: state.blocks.size,
    selected: state.selectedKeys.size,
    mode: state.mode,
    flowsOpen: state.flowsPanelOpen,
    zxOpen: state.zxPanelOpen,
  };
}

/**
 * Undo, Clear, or an import can drop totals below the step's baseline; follow
 * them down so the step asks for one new action on the current document
 * instead of stranding against a total that no longer exists. (Same rule as
 * the neutral-atom tour's clampBaseline.) Booleans clamp the same way — a
 * panel that was open at step start re-arms once the user closes it, so
 * "open the panel" steps can't strand when the panel began open.
 */
export function clampTutorialBaseline(
  baseline: TutorialSnapshot,
  current: TutorialSnapshot,
): TutorialSnapshot {
  const next = { ...baseline };
  for (const key of Object.keys(baseline) as Array<keyof TutorialSnapshot>) {
    const b = baseline[key];
    const c = current[key];
    if (typeof b === "number" && typeof c === "number" && c < b) {
      (next[key] as number) = c;
    } else if (typeof b === "boolean" && b === true && c === false) {
      (next[key] as boolean) = false;
    }
  }
  return next;
}

export type TutorialStep = {
  id: string;
  title: string;
  instruction: string;
  /** `data-tutorial` attribute values pulsed in the toolbar while active. */
  highlights: string[];
  /** Completion predicate; absent = passive step advanced by its button. */
  isComplete?: (now: TutorialSnapshot, baseline: TutorialSnapshot) => boolean;
};

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: "welcome",
    title: "Build your first pipe diagram",
    instruction:
      "A quick hands-on tour: cubes, pipes, ports, color rules, and "
      + "verification. Every step is a real edit — undo anytime with Ctrl/Cmd+Z.",
    highlights: [],
  },
  {
    id: "place-cube",
    title: "Place a cube",
    instruction:
      "Cubes are the logical blocks of a computation — each face is a "
      + "surface-code boundary (red = X, blue = Z). Click a cube type in the "
      + "Blocks palette, then click a grid cell to place it.",
    highlights: ["blocks-palette"],
    isComplete: (now, base) => now.cubes > base.cubes,
  },
  {
    id: "draw-pipe",
    title: "Connect with a pipe",
    instruction:
      "Pipes carry logical qubits between cubes through spacetime. Pick a "
      + "pipe from the Pipes palette and click a slot next to your cube.",
    highlights: ["pipes-palette"],
    isComplete: (now, base) => now.pipes > base.pipes,
  },
  {
    id: "cycle-type",
    title: "Cycle the cube's type",
    instruction:
      "A cube's type must match the colors of its attached pipes. Pick the "
      + "Select tool, click your cube, then press ← / → to cycle through the "
      + "types its pipes allow — watch the boundaries swap.",
    highlights: ["select-tool", "blocks-palette"],
    isComplete: (now, base) => now.typeCycles > base.typeCycles,
  },
  {
    id: "keyboard-build",
    title: "Extend with Keyboard Build",
    instruction:
      "Switch to Keyboard Build (Tab or the mode pill) — a cursor extends the "
      + "diagram from a block. Press W / A / S / D to lay pipe-and-cube steps; "
      + "take at least two.",
    highlights: ["mode-pill"],
    isComplete: (now, base) => now.buildSteps >= base.buildSteps + 2,
  },
  {
    id: "add-port",
    title: "Mark a port",
    instruction:
      "Ports are the open inputs/outputs where a computation connects to the "
      + "outside. Back in Drag / Drop mode, click Port in the palette, then "
      + "click the open end of a pipe.",
    highlights: ["port-tool", "mode-pill"],
    isComplete: (now, base) => now.ports > base.ports || now.portAdds > base.portAdds,
  },
  {
    id: "verify",
    title: "Verify the diagram",
    instruction:
      "Time to check the rules. Open Analyze ▾ and run Verify (tqec) — the "
      + "toast reports whether this is a valid TQEC block graph, and flags "
      + "any offending blocks.",
    highlights: ["analyze-menu"],
    isComplete: (now, base) => now.verifyRuns > base.verifyRuns,
  },
  {
    id: "load-template",
    title: "Study a real circuit",
    instruction:
      "Open File ▾ → Templates and Load the CNOT example — a lattice-surgery "
      + "CNOT between two logical qubits. (Load replaces the scene; your "
      + "sketch is one undo away.)",
    highlights: ["file-menu"],
    isComplete: (now, base) =>
      now.sceneLoads > base.sceneLoads || now.bulkAdds > base.bulkAdds,
  },
  {
    id: "copy-paste",
    title: "Duplicate instead of redrawing",
    instruction:
      "Select all with Ctrl/Cmd+A, copy with Ctrl/Cmd+C, then paste with "
      + "Ctrl/Cmd+V and click beside the original (or paste again) to place "
      + "the copy.",
    highlights: [],
    isComplete: (now, base) => now.bulkAdds > base.bulkAdds,
  },
  {
    id: "flows",
    title: "See the correlation surfaces",
    instruction:
      "Open Analyze ▾ → Flows (tqec) to compute the circuit's stabilizer "
      + "flows and visualize each correlation surface directly in 3D.",
    highlights: ["analyze-menu"],
    isComplete: (now, base) =>
      (now.flowsOpen && !base.flowsOpen) || (now.zxOpen && !base.zxOpen),
  },
  {
    id: "done",
    title: "That's the workflow",
    instruction:
      "Sketch, verify, analyze, export. Export ships a TQEC-compatible .dae; "
      + "Share link packs small scenes into a URL. Press ? for every "
      + "shortcut, and the ? button for this tour's big sibling — the manual.",
    highlights: ["file-menu"],
  },
];
