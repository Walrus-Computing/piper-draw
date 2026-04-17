import { describe, expect, it, beforeEach, vi } from "vitest";
import { useValidationStore } from "./validationStore";
import { useBlockStore } from "./blockStore";

// Mock the validate fetch call
vi.mock("../utils/validate", () => ({
  validateDiagram: vi.fn(),
}));

import { validateDiagram } from "../utils/validate";
const mockValidate = vi.mocked(validateDiagram);

function resetStores() {
  useBlockStore.setState({
    blocks: new Map(),
    spatialIndex: new Map(),
    hiddenFaces: new Map(),
    history: [],
    future: [],
    mode: "place",
    cubeType: "XZZ",
    pipeVariant: null,
    hoveredGridPos: null,
    hoveredBlockType: null,
    hoveredInvalid: false,
  });
  useValidationStore.setState({
    status: "idle",
    errors: [],
    invalidKeys: new Set(),
  });
}

describe("validationStore", () => {
  beforeEach(() => {
    resetStores();
    mockValidate.mockReset();
  });

  describe("validate", () => {
    it("sets status to valid on success", async () => {
      mockValidate.mockResolvedValue({ valid: true, errors: [] });

      await useValidationStore.getState().validate();

      expect(useValidationStore.getState().status).toBe("valid");
      expect(useValidationStore.getState().errors).toEqual([]);
      expect(useValidationStore.getState().invalidKeys.size).toBe(0);
    });

    it("sets status to invalid with errors on failure", async () => {
      mockValidate.mockResolvedValue({
        valid: false,
        errors: [
          { position: [0, 0, 0], message: "Cube has mismatched colors" },
        ],
      });

      await useValidationStore.getState().validate();

      const state = useValidationStore.getState();
      expect(state.status).toBe("invalid");
      expect(state.errors).toHaveLength(1);
      expect(state.errors[0].message).toBe("Cube has mismatched colors");
      expect(state.errors[0].position).toEqual({ x: 0, y: 0, z: 0 });
    });

    it("populates invalidKeys from error positions", async () => {
      mockValidate.mockResolvedValue({
        valid: false,
        errors: [
          { position: [0, 0, 0], message: "error 1" },
          { position: [3, 0, 0], message: "error 2" },
        ],
      });

      await useValidationStore.getState().validate();

      const keys = useValidationStore.getState().invalidKeys;
      expect(keys.size).toBe(2);
      expect(keys.has("0,0,0")).toBe(true);
      expect(keys.has("3,0,0")).toBe(true);
    });

    it("handles null-position errors (global errors)", async () => {
      mockValidate.mockResolvedValue({
        valid: false,
        errors: [
          { position: null, message: "Failed to build graph" },
        ],
      });

      await useValidationStore.getState().validate();

      const state = useValidationStore.getState();
      expect(state.status).toBe("invalid");
      expect(state.errors).toHaveLength(1);
      expect(state.errors[0].message).toBe("Failed to build graph");
      // Null-position errors should NOT add to invalidKeys
      expect(state.invalidKeys.size).toBe(0);
    });

    it("mixes positioned and global errors", async () => {
      mockValidate.mockResolvedValue({
        valid: false,
        errors: [
          { position: [0, 0, 0], message: "color mismatch" },
          { position: null, message: "graph build warning" },
        ],
      });

      await useValidationStore.getState().validate();

      const state = useValidationStore.getState();
      expect(state.errors).toHaveLength(2);
      expect(state.invalidKeys.size).toBe(1);
    });

    it("sets loading status while validating", async () => {
      let resolvePromise: (v: { valid: boolean; errors: never[] }) => void;
      mockValidate.mockReturnValue(
        new Promise((r) => { resolvePromise = r; }),
      );

      const promise = useValidationStore.getState().validate();
      expect(useValidationStore.getState().status).toBe("loading");

      resolvePromise!({ valid: true, errors: [] });
      await promise;
      expect(useValidationStore.getState().status).toBe("valid");
    });

    it("reads blocks from blockStore", async () => {
      const block = { pos: { x: 0, y: 0, z: 0 }, type: "XZZ" as const };
      useBlockStore.setState({
        blocks: new Map([["0,0,0", block]]),
      });
      mockValidate.mockResolvedValue({ valid: true, errors: [] });

      await useValidationStore.getState().validate();

      expect(mockValidate).toHaveBeenCalledWith(
        expect.any(Map),
      );
      const passedBlocks = mockValidate.mock.calls[0][0];
      expect(passedBlocks.size).toBe(1);
    });
  });

  describe("dismiss", () => {
    it("resets to idle", async () => {
      mockValidate.mockResolvedValue({
        valid: false,
        errors: [{ position: [0, 0, 0], message: "error" }],
      });
      await useValidationStore.getState().validate();

      useValidationStore.getState().dismiss();

      const state = useValidationStore.getState();
      expect(state.status).toBe("idle");
      expect(state.errors).toEqual([]);
      expect(state.invalidKeys.size).toBe(0);
    });

    it("is a no-op when already idle", () => {
      useValidationStore.getState().dismiss();
      expect(useValidationStore.getState().status).toBe("idle");
    });
  });

  describe("auto-dismiss on block changes", () => {
    it("dismisses when a block is added", async () => {
      mockValidate.mockResolvedValue({
        valid: false,
        errors: [{ position: [0, 0, 0], message: "error" }],
      });
      await useValidationStore.getState().validate();
      expect(useValidationStore.getState().status).toBe("invalid");

      // Add a block near an error — should auto-revalidate
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });

      expect(useValidationStore.getState().status).toBe("loading");
    });

    it("dismisses when a block is removed", async () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });

      mockValidate.mockResolvedValue({ valid: true, errors: [] });
      await useValidationStore.getState().validate();
      expect(useValidationStore.getState().status).toBe("valid");

      useBlockStore.getState().removeBlock({ x: 0, y: 0, z: 0 });

      expect(useValidationStore.getState().status).toBe("idle");
    });

    it("dismisses on clearAll", async () => {
      useBlockStore.getState().addBlock({ x: 0, y: 0, z: 0 });
      mockValidate.mockResolvedValue({ valid: true, errors: [] });
      await useValidationStore.getState().validate();

      useBlockStore.getState().clearAll();

      expect(useValidationStore.getState().status).toBe("idle");
    });
  });
});
