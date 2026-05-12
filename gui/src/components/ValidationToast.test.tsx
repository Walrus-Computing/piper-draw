import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act, cleanup, fireEvent } from "@testing-library/react";
import { useRef } from "react";
import { ValidationToast } from "./ValidationToast";
import { useValidationStore } from "../stores/validationStore";
import { useBlockStore } from "../stores/blockStore";

// Test harness — supplies the required refs without dragging in Three.js.
function Harness() {
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controlsRef = useRef<any>(null);
  return (
    <>
      <div ref={toolbarRef} data-testid="harness-toolbar" />
      <ValidationToast toolbarRef={toolbarRef} controlsRef={controlsRef} />
    </>
  );
}

function resetStores() {
  act(() => {
    useValidationStore.setState({
      status: "idle",
      errors: [],
      invalidKeys: new Set(),
      selectedErrorKey: null,
    });
    useBlockStore.setState({ freeBuild: false });
  });
}

beforeEach(resetStores);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ValidationToast — UC1: Enable Free Build button", () => {
  it("D1: renders 'Enable Free Build' button when status='invalid' and freeBuild=false", () => {
    act(() => {
      useValidationStore.setState({
        status: "invalid",
        errors: [{ position: { x: 0, y: 0, z: 0 }, message: "Color rule violation" }],
        invalidKeys: new Set(["0,0,0"]),
      });
    });
    render(<Harness />);
    expect(screen.queryByText("Enable Free Build")).toBeTruthy();
  });

  it("D2: no 'Enable Free Build' button when status='valid'", () => {
    act(() => {
      useValidationStore.setState({ status: "valid", errors: [], invalidKeys: new Set() });
    });
    render(<Harness />);
    expect(screen.queryByText("Enable Free Build")).toBeNull();
  });

  it("D3: click flips freeBuild ON and dismisses toast", () => {
    act(() => {
      useValidationStore.setState({
        status: "invalid",
        errors: [{ position: { x: 0, y: 0, z: 0 }, message: "Color rule violation" }],
        invalidKeys: new Set(["0,0,0"]),
      });
    });
    render(<Harness />);
    fireEvent.click(screen.getByText("Enable Free Build"));
    expect(useBlockStore.getState().freeBuild).toBe(true);
    expect(useValidationStore.getState().status).toBe("idle");
  });

  it("D5: button is NOT rendered when freeBuild is already true (avoid no-op affordance)", () => {
    act(() => {
      useValidationStore.setState({
        status: "invalid",
        errors: [{ position: { x: 0, y: 0, z: 0 }, message: "Color rule violation" }],
        invalidKeys: new Set(["0,0,0"]),
      });
      useBlockStore.setState({ freeBuild: true });
    });
    render(<Harness />);
    expect(screen.queryByText("Enable Free Build")).toBeNull();
  });

  it("D6: no 'Enable Free Build' button when status='error' (server-down — FB doesn't help)", () => {
    act(() => {
      useValidationStore.setState({
        status: "error",
        errors: [{ position: { x: NaN, y: NaN, z: NaN }, message: "Verification server not available. Start with: npm run dev" }],
        invalidKeys: new Set(),
      });
    });
    render(<Harness />);
    // The toast renders (server-down message visible), but no FB button.
    expect(screen.queryByText(/not available/)).toBeTruthy();
    expect(screen.queryByText("Enable Free Build")).toBeNull();
  });
});
