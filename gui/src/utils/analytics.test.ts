import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HEARTBEAT_INTERVAL_MS, startHeartbeat, track } from "./analytics";

describe("analytics", () => {
  let stop: (() => void) | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    stop?.();
    stop = null;
    delete window.umami;
    vi.useRealTimers();
  });

  describe("track", () => {
    it("no-ops without a tracker", () => {
      expect(() => track("anything")).not.toThrow();
    });

    it("forwards name and data to window.umami", () => {
      const spy = vi.fn();
      window.umami = { track: spy };
      track("dae-exported", { blocks: 3 });
      expect(spy).toHaveBeenCalledWith("dae-exported", { blocks: 3 });
    });

    it("swallows tracker exceptions", () => {
      window.umami = {
        track: () => {
          throw new Error("tracker blew up");
        },
      };
      expect(() => track("anything")).not.toThrow();
    });
  });

  describe("startHeartbeat", () => {
    it("emits a heartbeat only for minutes with user activity", () => {
      const spy = vi.fn();
      window.umami = { track: spy };
      stop = startHeartbeat();

      // Minute 1: activity → heartbeat.
      window.dispatchEvent(new Event("keydown"));
      vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith("heartbeat", undefined);

      // Minute 2: idle → nothing.
      vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
      expect(spy).toHaveBeenCalledTimes(1);

      // Minute 3: activity again → second heartbeat.
      window.dispatchEvent(new Event("pointerdown"));
      vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it("does not emit while the tab is hidden", () => {
      const spy = vi.fn();
      window.umami = { track: spy };
      const visibility = vi
        .spyOn(document, "visibilityState", "get")
        .mockReturnValue("hidden");
      stop = startHeartbeat();

      window.dispatchEvent(new Event("keydown"));
      vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
      expect(spy).not.toHaveBeenCalled();

      visibility.mockRestore();
    });

    it("stops emitting after the returned stop function runs", () => {
      const spy = vi.fn();
      window.umami = { track: spy };
      stop = startHeartbeat();
      stop();
      stop = null;

      window.dispatchEvent(new Event("keydown"));
      vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
      expect(spy).not.toHaveBeenCalled();
    });
  });
});
