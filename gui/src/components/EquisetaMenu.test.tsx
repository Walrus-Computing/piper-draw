import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, cleanup, fireEvent } from "@testing-library/react";
import { EquisetaMenu } from "./EquisetaMenu";
import { useBlockStore } from "../stores/blockStore";
import { useEquisetaJsonStore } from "../stores/equisetaJsonStore";

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  act(() => {
    useEquisetaJsonStore.setState({
      loaded: null,
      loading: false,
      loadingLabel: null,
      error: null,
      viewMode: "json",
      loadToken: 0,
    });
    useBlockStore.getState().setEquisetaPanelOpen(false);
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  cleanup();
  vi.restoreAllMocks();
});

function mockManifestSuccess() {
  globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : (input as Request | URL).toString();
    if (url.endsWith("manifest.json")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            examples: [
              { filename: "all_open.json", name: "All open", description: "Minimal connector" },
              { filename: "two_cubes.json", name: "Two cubes", description: "Adjacent" },
            ],
          }),
          { status: 200 },
        ),
      );
    }
    return Promise.resolve(new Response("not used", { status: 404 }));
  }) as unknown as typeof fetch;
}

function mockManifestFailure() {
  globalThis.fetch = vi.fn(() => Promise.resolve(new Response("nope", { status: 404 }))) as unknown as typeof fetch;
}

async function flush() {
  // Allow pending microtasks / state updates from a fetch resolve.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("EquisetaMenu", () => {
  it("renders the toggle button (closed by default)", () => {
    mockManifestSuccess();
    render(<EquisetaMenu />);
    const btn = screen.getByText(/^Equiseta/);
    expect(btn).toBeTruthy();
    expect(screen.queryByTestId("equiseta-dropdown")).toBeNull();
  });

  it("opens the dropdown on click and shows the Open JSON… item", async () => {
    mockManifestSuccess();
    render(<EquisetaMenu />);
    fireEvent.click(screen.getByText(/^Equiseta/));
    expect(screen.getByTestId("equiseta-dropdown")).toBeTruthy();
    expect(screen.getByText("Open JSON…")).toBeTruthy();
  });

  it("lazy-fetches manifest on first open and lists the returned examples", async () => {
    mockManifestSuccess();
    render(<EquisetaMenu />);
    fireEvent.click(screen.getByText(/^Equiseta/));
    await flush();
    expect(screen.getByText("All open")).toBeTruthy();
    expect(screen.getByText("Two cubes")).toBeTruthy();
  });

  it("falls back to hardcoded list with Retry when manifest fetch fails", async () => {
    mockManifestFailure();
    render(<EquisetaMenu />);
    fireEvent.click(screen.getByText(/^Equiseta/));
    await flush();
    // Hardcoded fallback shows the first filename
    expect(screen.getByText("all open")).toBeTruthy();
    // Retry item
    expect(screen.getByText(/^↻ Retry/)).toBeTruthy();
  });

  it("Retry refires the manifest fetch", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(() => {
      calls++;
      if (calls === 1) return Promise.resolve(new Response("nope", { status: 404 }));
      return Promise.resolve(
        new Response(
          JSON.stringify({
            examples: [{ filename: "x.json", name: "X", description: "x" }],
          }),
          { status: 200 },
        ),
      );
    }) as unknown as typeof fetch;
    render(<EquisetaMenu />);
    fireEvent.click(screen.getByText(/^Equiseta/));
    await flush();
    fireEvent.click(screen.getByText(/^↻ Retry/));
    await flush();
    // After retry, the fallback list and retry button should be gone, and the new manifest item present
    expect(screen.queryByText(/^↻ Retry/)).toBeNull();
    expect(screen.getByText("X")).toBeTruthy();
  });

  it("closes the dropdown when the user clicks outside", async () => {
    mockManifestSuccess();
    render(<EquisetaMenu />);
    fireEvent.click(screen.getByText(/^Equiseta/));
    await flush();
    expect(screen.getByTestId("equiseta-dropdown")).toBeTruthy();
    // mousedown outside the wrap closes via the document listener
    act(() => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(screen.queryByTestId("equiseta-dropdown")).toBeNull();
  });

  it("clicking an example invokes loadEquisetaFixture (panel opens, beginLoad fires)", async () => {
    mockManifestSuccess();
    // Mock the fixture fetch (separate from manifest)
    const realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as Request | URL).toString();
      if (url.endsWith("manifest.json")) {
        // Reuse the manifest response
        return (realFetch as unknown as (i: RequestInfo | URL) => Promise<Response>)(input);
      }
      // Fixture request
      return Promise.resolve(
        new Response(
          JSON.stringify({
            nodes: [],
            edges: [],
          }),
          { status: 200 },
        ),
      );
    }) as unknown as typeof fetch;
    render(<EquisetaMenu />);
    fireEvent.click(screen.getByText(/^Equiseta/));
    await flush();
    fireEvent.click(screen.getByText("All open"));
    await flush();
    expect(useBlockStore.getState().equisetaPanelOpen).toBe(true);
    // After successful load with empty graph, store has loaded value
    expect(useEquisetaJsonStore.getState().loaded?.sourceLabel).toBe("All open");
  });
});
