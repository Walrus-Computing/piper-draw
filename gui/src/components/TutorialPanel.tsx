import { useEffect } from "react";
import { useBlockStore } from "../stores/blockStore";
import { useTutorialStore } from "../stores/tutorialStore";
import { TUTORIAL_STEPS, type TutorialStep } from "../utils/tutorialSteps";

/** Pulse the active step's targets, including menu items mounted later. */
function useStepHighlights(active: boolean, step: TutorialStep | undefined) {
  useEffect(() => {
    if (!active || !step) return;
    const marked = new Set<HTMLElement>();
    const sync = () => {
      const next = new Set<HTMLElement>();
      for (const target of step.highlights) {
        for (const element of document.querySelectorAll<HTMLElement>(
          `[data-tutorial="${target}"]`,
        )) {
          element.classList.add("tutorial-target");
          next.add(element);
        }
      }
      for (const element of marked) {
        if (!next.has(element)) element.classList.remove("tutorial-target");
      }
      marked.clear();
      for (const element of next) marked.add(element);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      for (const element of marked) element.classList.remove("tutorial-target");
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
      <span style={{ fontSize: 12, color: "#666", whiteSpace: "nowrap" }}>
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

function BackButton({ visible, onBack }: { visible: boolean; onBack: () => void }) {
  if (!visible) return <span />;
  return (
    <button
      onClick={onBack}
      style={{
        background: "none",
        border: "none",
        padding: "3px 0",
        cursor: "pointer",
        color: "#555",
        fontSize: 13,
      }}
    >
      ← Back
    </button>
  );
}

function StepFooter({
  step,
  isFirst,
  isLast,
  reviewing,
  celebrating,
  onBack,
  onAdvance,
}: {
  step: TutorialStep;
  isFirst: boolean;
  isLast: boolean;
  reviewing: boolean;
  celebrating: boolean;
  onBack: () => void;
  onAdvance: () => void;
}) {
  const waitsForAction = step.isComplete !== undefined && !reviewing;
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginTop: 10,
      }}
    >
      <BackButton visible={!isFirst && !celebrating} onBack={onBack} />
      {waitsForAction ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, color: celebrating ? "#34a853" : "#4a9eff" }}>
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
              fontSize: 13,
            }}
          >
            Skip
          </button>
        </div>
      ) : (
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
            fontSize: 14,
          }}
        >
          {isLast ? "Finish" : reviewing ? "Next" : isFirst ? "Start tour" : "Continue"}
        </button>
      )}
    </div>
  );
}

export function TutorialPanel() {
  const active = useTutorialStore((state) => state.active);
  const stepIndex = useTutorialStore((state) => state.stepIndex);
  const furthestStepIndex = useTutorialStore((state) => state.furthestStepIndex);
  const celebrating = useTutorialStore((state) => state.celebrating);
  const advance = useTutorialStore((state) => state.advance);
  const back = useTutorialStore((state) => state.back);
  const dismiss = useTutorialStore((state) => state.dismiss);

  const step = TUTORIAL_STEPS[stepIndex];
  useStepHighlights(active, step);
  const analysisOpen = useBlockStore(
    (state) => state.flowsPanelOpen || state.zxPanelOpen,
  );

  if (!active || !step) return null;

  return (
    <div
      role="dialog"
      aria-label="Interactive tutorial"
      style={{
        position: "fixed",
        ...(analysisOpen ? { left: 16 } : { right: 16 }),
        bottom: 56,
        width: 340,
        zIndex: 60,
        background: "#fff",
        border: `2px solid ${celebrating ? "#34a853" : "#4a9eff"}`,
        borderRadius: 10,
        boxShadow: "0 6px 24px rgba(0,0,0,0.18)",
        padding: "14px 16px",
        fontFamily: "sans-serif",
        fontSize: 16,
        color: "#222",
        lineHeight: 1.5,
        transition: "border-color 0.2s",
      }}
    >
      <ProgressHeader
        stepIndex={stepIndex}
        celebrating={celebrating}
        onDismiss={dismiss}
      />
      <div style={{ fontWeight: 600, fontSize: 17, marginBottom: 5 }}>
        {celebrating ? "✓ " : ""}
        {step.title}
      </div>
      <p style={{ margin: 0 }}>{step.instruction}</p>
      <StepFooter
        step={step}
        isFirst={stepIndex === 0}
        isLast={stepIndex === TUTORIAL_STEPS.length - 1}
        reviewing={stepIndex < furthestStepIndex}
        celebrating={celebrating}
        onBack={back}
        onAdvance={advance}
      />
    </div>
  );
}
