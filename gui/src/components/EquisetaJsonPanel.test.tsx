import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, cleanup, fireEvent } from "@testing-library/react";
import { EquisetaJsonPanel } from "./EquisetaJsonPanel";
import { useBlockStore } from "../stores/blockStore";
import { useEquisetaJsonStore } from "../stores/equisetaJsonStore";
import type { FtqcGraph } from "../utils/equisetaJsonSchema";

// A minimal valid graph for tests that need pre-loaded state.
function fakeGraph(): FtqcGraph {
  return {
    nodes: [
      {
        coordinate: [0, 0, 0],
        faces: { top: "red", bottom: "red", north: "red", south: "red", east: "red", west: "red" },
        ridges: {
          I_BOT_SOUTH: null, I_BOT_NORTH: null, I_TOP_SOUTH: null, I_TOP_NORTH: null,
          J_BOT_WEST: null, J_BOT_EAST: null, J_TOP_WEST: null, J_TOP_EAST: null,
          K_SOUTH_WEST: null, K_SOUTH_EAST: null, K_NORTH_WEST: null, K_NORTH_EAST: null,
        },
      },
    ],
    edges: [],
  };
}

beforeEach(() => {
  // Reset both stores to known state.
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
  cleanup();
  vi.restoreAllMocks();
});

describe("EquisetaJsonPanel", () => {
  it("renders the panel even when closed (display: none) so loaded data persists", () => {
    render(<EquisetaJsonPanel />);
    const panel = screen.getByTestId("equiseta-json-panel");
    expect(panel).toBeTruthy();
    expect((panel as HTMLElement).style.display).toBe("none");
  });

  it("shows display:block when equisetaPanelOpen is true", () => {
    act(() => useBlockStore.getState().setEquisetaPanelOpen(true));
    render(<EquisetaJsonPanel />);
    const panel = screen.getByTestId("equiseta-json-panel");
    expect((panel as HTMLElement).style.display).toBe("block");
  });

  it("renders the empty-state hint when no JSON has been loaded", () => {
    act(() => useBlockStore.getState().setEquisetaPanelOpen(true));
    render(<EquisetaJsonPanel />);
    expect(screen.getByTestId("empty-state")).toBeTruthy();
  });

  it("renders the loading state with spinner when loading and no prior loaded content", () => {
    act(() => {
      useBlockStore.getState().setEquisetaPanelOpen(true);
      useEquisetaJsonStore.setState({ loading: true, loadingLabel: "All open" });
    });
    render(<EquisetaJsonPanel />);
    expect(screen.getByTestId("loading-state")).toBeTruthy();
    expect(screen.getByTestId("loading-state").textContent).toContain("All open");
  });

  it("renders the JSON view by default after a successful load", () => {
    act(() => {
      useBlockStore.getState().setEquisetaPanelOpen(true);
      useEquisetaJsonStore.setState({
        loaded: { graph: fakeGraph(), sourceLabel: "fake.json" },
      });
    });
    render(<EquisetaJsonPanel />);
    expect(screen.getByTestId("json-view")).toBeTruthy();
    expect(screen.queryByTestId("grid-view")).toBeNull();
  });

  it("toggles to Grid view when the Grid button is clicked", () => {
    act(() => {
      useBlockStore.getState().setEquisetaPanelOpen(true);
      useEquisetaJsonStore.setState({
        loaded: { graph: fakeGraph(), sourceLabel: "fake.json" },
      });
    });
    render(<EquisetaJsonPanel />);
    fireEvent.click(screen.getByText("Grid"));
    expect(screen.getByTestId("grid-view")).toBeTruthy();
    expect(screen.queryByTestId("json-view")).toBeNull();
  });

  it("renders an inline error when the store has an error message", () => {
    act(() => {
      useBlockStore.getState().setEquisetaPanelOpen(true);
      useEquisetaJsonStore.setState({ error: "Schema mismatch at $.nodes" });
    });
    render(<EquisetaJsonPanel />);
    const err = screen.getByTestId("inline-error");
    expect(err.textContent).toContain("Schema mismatch at $.nodes");
  });

  it("clearError fires when the dismiss × is clicked", () => {
    act(() => {
      useBlockStore.getState().setEquisetaPanelOpen(true);
      useEquisetaJsonStore.setState({ error: "boom" });
    });
    render(<EquisetaJsonPanel />);
    const err = screen.getByTestId("inline-error");
    const dismiss = err.querySelector("button");
    expect(dismiss).toBeTruthy();
    fireEvent.click(dismiss!);
    expect(useEquisetaJsonStore.getState().error).toBeNull();
  });

  it("setEquisetaPanelOpen(false) when × header button is clicked", () => {
    act(() => useBlockStore.getState().setEquisetaPanelOpen(true));
    render(<EquisetaJsonPanel />);
    fireEvent.click(screen.getByLabelText("Close panel"));
    expect(useBlockStore.getState().equisetaPanelOpen).toBe(false);
  });

  it("renders stats header when loaded", () => {
    act(() => {
      useBlockStore.getState().setEquisetaPanelOpen(true);
      useEquisetaJsonStore.setState({
        loaded: { graph: fakeGraph(), sourceLabel: "x" },
      });
    });
    render(<EquisetaJsonPanel />);
    const stats = screen.getByTestId("stats-header");
    expect(stats.textContent).toContain("1 node");
    expect(stats.textContent).toContain("0 edges");
    expect(stats.textContent).toContain("red");
  });

  it("loaded state survives a close+reopen cycle (panel stays mounted)", () => {
    act(() => {
      useBlockStore.getState().setEquisetaPanelOpen(true);
      useEquisetaJsonStore.setState({
        loaded: { graph: fakeGraph(), sourceLabel: "persisted.json" },
      });
    });
    const { rerender } = render(<EquisetaJsonPanel />);
    expect(screen.getByTestId("json-view")).toBeTruthy();
    // Close
    act(() => useBlockStore.getState().setEquisetaPanelOpen(false));
    rerender(<EquisetaJsonPanel />);
    // Panel is hidden, but the data is still in the store
    expect(useEquisetaJsonStore.getState().loaded?.sourceLabel).toBe("persisted.json");
    // Reopen
    act(() => useBlockStore.getState().setEquisetaPanelOpen(true));
    rerender(<EquisetaJsonPanel />);
    expect(screen.getByTestId("json-view")).toBeTruthy();
  });
});
