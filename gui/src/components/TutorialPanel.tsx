import { useEffect } from "react";
import { useBlockStore } from "../stores/blockStore";
import { useTutorialStore } from "../stores/tutorialStore";
import { TUTORIAL_STEPS, type TutorialStep } from "../utils/tutorialSteps";

/**
 * Floating card for the interactive tutorial. Renders the active step's
 * instruction with a progress bar, pulses the relevant toolbar controls
 * (elements carrying a matching `data-tutorial` attribute get the
 * `.tutorial-target` CSS class), and shows a brief "✓" beat when the step's
 * completion predicate fires before auto-advancing. Action steps offer Skip;
 * the passive first/last steps use a primary Start/Finish button.
 */

/** Pulse the step's toolbar targets. Buttons live in the always-mounted
 * toolbar, so applying classes on step change is sufficient — no per-render
 * re-query needed. */
function useStepHighlights(active: boolean, step: TutorialStep | undefined) {
  useEffect(() => {
    if (!active || !step) return;
    const marked: HTMLElement[] = [];
    for (const target of step.highlights) {
      for (const el of document.querySelectorAll<HTMLElement>(`[data-tutorial="${target}"]`)) {
        el.classList.add("tutorial-target");
        marked.push(el);
      }
    }
    return () => {
      for (const el of marked) el.classList.remove("tutorial-target");
    };
  }, [active, step]);
}

function ProgressHeader({
  stepIndex,
  celebrating,
  onDismiss,
}: {
  stepIndex: number;
  celebrating: boolean;
  onDismiss: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
      <span style={{ fontSize: 11, color: "#666", whiteSpace: "nowrap" }}>
        {stepIndex + 1} of {TUTORIAL_STEPS.length}
      </span>
      <div style={{ flex: 1, height: 4, background: "#e4e9f0", borderRadius: 2 }}>
        <div
          style={{
            width: `${(stepIndex / (TUTORIAL_STEPS.length - 1)) * 100}%`,
            height: "100%",
            background: celebrating ? "#34a853" : "#4a9eff",
            borderRadius: 2,
            transition: "width 0.25s, background 0.2s",
          }}
        />
      </div>
      <button
        onClick={onDismiss}
        aria-label="Close tutorial"
        title="Close tutorial"
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "#888",
          fontSize: 15,
          padding: "0 2px",
          lineHeight: 1,
        }}
      >
        ✕
      </button>
    </div>
  );
}

function StepFooter({
  step,
  isLast,
  celebrating,
  onAdvance,
}: {
  step: TutorialStep;
  isLast: boolean;
  celebrating: boolean;
  onAdvance: () => void;
}) {
  const waitsForAction = step.isComplete !== undefined;
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginTop: 10,
      }}
    >
      {waitsForAction ? (
        <>
          <span style={{ fontSize: 11, color: celebrating ? "#34a853" : "#4a9eff" }}>
            {celebrating ? "Nice — moving on…" : "Do it in the scene to continue"}
          </span>
          <button
            onClick={onAdvance}
            style={{
              background: "none",
              border: "1px solid #ccc",
              borderRadius: 4,
              padding: "3px 10px",
              cursor: "pointer",
              color: "#555",
              fontSize: 12,
            }}
          >
            Skip
          </button>
        </>
      ) : (
        <>
          <span />
          <button
            onClick={onAdvance}
            style={{
              background: "#4a9eff",
              border: "none",
              borderRadius: 4,
              padding: "5px 14px",
              cursor: "pointer",
              color: "#fff",
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            {isLast ? "Finish" : "Start tour"}
          </button>
        </>
      )}
    </div>
  );
}

export function TutorialPanel() {
  const active = useTutorialStore((s) => s.active);
  const stepIndex = useTutorialStore((s) => s.stepIndex);
  const celebrating = useTutorialStore((s) => s.celebrating);
  const advance = useTutorialStore((s) => s.advance);
  const dismiss = useTutorialStore((s) => s.dismiss);

  const step = TUTORIAL_STEPS[stepIndex];
  useStepHighlights(active, step);
  // The Flows/ZX floating panels dock bottom-right; move the card to the left
  // edge while one is open so the tour never covers the panel it points at.
  const analysisOpen = useBlockStore((s) => s.flowsPanelOpen || s.zxPanelOpen);

  if (!active || !step) return null;

  return (
    <div
      role="dialog"
      aria-label="Interactive tutorial"
      style={{
        position: "fixed",
        ...(analysisOpen ? { left: 16 } : { right: 16 }),
        bottom: 56,
        width: 300,
        zIndex: 60,
        background: "#fff",
        border: `2px solid ${celebrating ? "#34a853" : "#4a9eff"}`,
        borderRadius: 10,
        boxShadow: "0 6px 24px rgba(0,0,0,0.18)",
        padding: "12px 14px",
        fontFamily: "sans-serif",
        fontSize: 13,
        color: "#222",
        lineHeight: 1.45,
        transition: "border-color 0.2s",
      }}
    >
      <ProgressHeader stepIndex={stepIndex} celebrating={celebrating} onDismiss={dismiss} />
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
        {celebrating ? "✓ " : ""}
        {step.title}
      </div>
      <p style={{ margin: 0 }}>{step.instruction}</p>
      <StepFooter
        step={step}
        isLast={stepIndex === TUTORIAL_STEPS.length - 1}
        celebrating={celebrating}
        onAdvance={advance}
      />
    </div>
  );
}
