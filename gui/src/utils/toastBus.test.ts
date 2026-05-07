import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { toastBus } from "./toastBus";
import { useValidationStore } from "../stores/validationStore";

// ---------------------------------------------------------------------------
// PR 5a — toast bus mechanics + integration with validationStore.
// Required by /plan-eng-review section 3 (3A=B): tests cover both the bus
// itself and the validationStore subscription contract. The R7 regression
// test guards against the channel-misuse pattern where an info toast
// (auto-dissolve, "select 2+", migration notice) would clobber an in-progress
// verify's invalid-block highlights.
//
// Each test installs only test-local listeners and tears them down in
// afterEach via the returned unsubscribe — never touch the module-init
// validationStore subscription, since vitest may run other files later that
// rely on it.
// ---------------------------------------------------------------------------

describe("toastBus", () => {
  describe("mechanics", () => {
    const teardown: Array<() => void> = [];
    afterEach(() => {
      while (teardown.length) teardown.pop()!();
    });

    it("delivers messages to subscribers synchronously", () => {
      let received: string | null = null;
      teardown.push(toastBus.info.subscribe((msg) => {
        received = msg;
      }));
      toastBus.info.emit("hello");
      expect(received).toBe("hello");
    });

    it("delivers to multiple subscribers in order", () => {
      const log: string[] = [];
      teardown.push(toastBus.info.subscribe((m) => log.push(`a:${m}`)));
      teardown.push(toastBus.info.subscribe((m) => log.push(`b:${m}`)));
      toastBus.info.emit("ping");
      expect(log).toEqual(["a:ping", "b:ping"]);
    });

    it("returns an unsubscribe function that detaches the listener", () => {
      const log: string[] = [];
      const unsub = toastBus.info.subscribe((m) => log.push(m));
      toastBus.info.emit("first");
      unsub();
      toastBus.info.emit("second");
      expect(log).toEqual(["first"]);
    });

    it("isolates the error and info channels", () => {
      const errLog: string[] = [];
      const infoLog: string[] = [];
      teardown.push(toastBus.error.subscribe((m) => errLog.push(m)));
      teardown.push(toastBus.info.subscribe((m) => infoLog.push(m)));
      toastBus.error.emit("err");
      toastBus.info.emit("info");
      expect(errLog).toEqual(["err"]);
      expect(infoLog).toEqual(["info"]);
    });
  });

  describe("integration with validationStore", () => {
    beforeEach(() => {
      useValidationStore.setState({
        status: "idle",
        errors: [],
        invalidKeys: new Set(),
        selectedErrorKey: null,
      });
    });

    it("error channel routes through reportEphemeralError", () => {
      toastBus.error.emit("Rotation aborted: blocked by neighbour");
      const s = useValidationStore.getState();
      expect(s.status).toBe("aborted");
      expect(s.errors).toHaveLength(1);
      expect(s.errors[0].message).toBe("Rotation aborted: blocked by neighbour");
    });

    it("R7 regression: info-channel emissions do NOT clobber invalid state", () => {
      // Simulate: user runs verify, gets two invalid blocks, then triggers
      // an auto-dissolve toast (info channel). The dissolve toast must NOT
      // wipe the invalidKeys / errors array — those drive the red highlights
      // in InvalidBlockHighlights.tsx.
      useValidationStore.setState({
        status: "invalid",
        errors: [
          { position: { x: 0, y: 0, z: 0 }, message: "mismatch" },
          { position: { x: 3, y: 0, z: 0 }, message: "mismatch" },
        ],
        invalidKeys: new Set(["0,0,0", "3,0,0"]),
        selectedErrorKey: null,
      });

      toastBus.info.emit("Group dissolved (only 1 member left)");

      const s = useValidationStore.getState();
      expect(s.status).toBe("invalid");
      expect(s.errors).toHaveLength(2);
      expect(s.invalidKeys.size).toBe(2);
      expect(s.invalidKeys.has("0,0,0")).toBe(true);
      expect(s.invalidKeys.has("3,0,0")).toBe(true);
    });

    it("error channel still aborts an in-flight invalid state (intentional)", () => {
      // Sanity: explicit ERROR-channel emissions remain destructive — that is
      // the documented contract (rotation aborted, etc.). Only the info
      // channel is non-destructive.
      useValidationStore.setState({
        status: "invalid",
        errors: [{ position: { x: 0, y: 0, z: 0 }, message: "mismatch" }],
        invalidKeys: new Set(["0,0,0"]),
        selectedErrorKey: null,
      });

      toastBus.error.emit("Rotation aborted: blocked");

      const s = useValidationStore.getState();
      expect(s.status).toBe("aborted");
      expect(s.invalidKeys.size).toBe(0);
    });
  });
});
