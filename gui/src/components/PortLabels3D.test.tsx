import { describe, expect, it, vi } from "vitest";

const preloadFontMock = vi.fn();

vi.mock("troika-three-text", () => ({
  preloadFont: (opts: unknown, cb?: () => void) => {
    preloadFontMock(opts);
    cb?.();
  },
}));

vi.mock("@react-three/drei", () => ({
  Billboard: () => null,
  Text: () => null,
}));

describe("PortLabels3D module", () => {
  it("warms troika's font at import time so the first <Text> mount does not suspend the Canvas", async () => {
    await import("./PortLabels3D");
    expect(preloadFontMock).toHaveBeenCalled();
  });
});
