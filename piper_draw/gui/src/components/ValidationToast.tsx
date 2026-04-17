import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { useValidationStore } from "../stores/validationStore";
import type { ValidationError } from "../stores/validationStore";
import { tqecToThree, posKey } from "../types";
import { animateCamera } from "../utils/cameraAnim";

function navigateToError(error: ValidationError, controlsRef: React.RefObject<any>) {
  const controls = controlsRef.current;
  if (!controls || isNaN(error.position.x)) return;
  const [tx, ty, tz] = tqecToThree(error.position, "XZZ");
  const camera = controls.object as THREE.PerspectiveCamera;
  const endTarget = new THREE.Vector3(tx, ty, tz);
  const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
  const endPos = endTarget.clone().add(offset);
  animateCamera(controls, endTarget, endPos, { duration: 400 });
}

const baseStyle: React.CSSProperties = {
  position: "fixed",
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 2,
  padding: "8px 16px",
  borderRadius: "6px",
  fontFamily: "sans-serif",
  fontSize: "13px",
  boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
  maxWidth: "500px",
  textAlign: "center" as const,
};

const styleVariants: Record<string, React.CSSProperties> = {
  loading: { background: "#e8f0fe", color: "#1a56db", cursor: "default" },
  valid: { background: "#d4edda", color: "#155724", border: "1px solid #c3e6cb", cursor: "pointer" },
  invalid: { background: "#f8d7da", color: "#721c24", border: "1px solid #f5c6cb" },
  error: { background: "#fff3cd", color: "#856404", border: "1px solid #ffeeba" },
};

const errorRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  padding: "2px 0",
};

const errorTextStyle: React.CSSProperties = {
  cursor: "pointer",
  flex: 1,
  textAlign: "left",
};

const rowCloseStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  fontSize: "13px",
  lineHeight: 1,
  padding: "0 2px",
  opacity: 0.5,
  color: "inherit",
  flexShrink: 0,
};

const dismissAllStyle: React.CSSProperties = {
  marginTop: "6px",
  background: "none",
  border: "1px solid rgba(114, 28, 36, 0.3)",
  color: "#721c24",
  padding: "3px 10px",
  borderRadius: "4px",
  cursor: "pointer",
  fontSize: "11px",
};

export function ValidationToast({
  toolbarRef,
  controlsRef,
}: {
  toolbarRef: React.RefObject<HTMLDivElement | null>;
  controlsRef: React.RefObject<any>;
}) {
  const status = useValidationStore((s) => s.status);
  const errors = useValidationStore((s) => s.errors);
  const dismiss = useValidationStore((s) => s.dismiss);
  const dismissError = useValidationStore((s) => s.dismissError);
  const selectError = useValidationStore((s) => s.selectError);
  const [topOffset, setTopOffset] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (status === "idle" || !toolbarRef.current) return;
    const rect = toolbarRef.current.getBoundingClientRect();
    setTopOffset(rect.bottom + 8);
  }, [status, toolbarRef]);

  useEffect(() => {
    if (status === "valid") {
      const t = setTimeout(dismiss, 3000);
      return () => clearTimeout(t);
    }
  }, [status, dismiss]);

  // Collapse back when errors shrink to fit
  useEffect(() => {
    if (expanded && errors.length <= 5) setExpanded(false);
  }, [expanded, errors.length]);

  if (status === "idle") return null;

  const variantKey = status === "invalid" && errors.some((e) => e.message.includes("not available")) ? "error" : status;
  const style: React.CSSProperties = {
    ...baseStyle,
    ...styleVariants[variantKey],
    position: "fixed",
    top: topOffset,
  };

  if (status === "loading") {
    return <div style={style}>Verifying with tqec...</div>;
  }

  if (status === "valid") {
    return (
      <div style={style} onClick={dismiss}>
        Diagram is valid
      </div>
    );
  }

  // Invalid / error status
  const MAX_VISIBLE = 5;
  const hasOverflow = errors.length > MAX_VISIBLE;
  const visibleErrors = expanded ? errors : errors.slice(0, MAX_VISIBLE);

  const renderErrorRow = (e: ValidationError, i: number) => {
    const hasPosition = !isNaN(e.position.x);
    return (
      <div key={i} style={errorRowStyle}>
        <span
          style={{
            ...errorTextStyle,
            cursor: hasPosition ? "pointer" : "default",
          }}
          onClick={() => {
            if (hasPosition) {
              selectError(posKey(e.position));
              navigateToError(e, controlsRef);
            }
          }}
          onMouseEnter={(ev) => { if (hasPosition) (ev.currentTarget as HTMLElement).style.textDecoration = "underline"; }}
          onMouseLeave={(ev) => { (ev.currentTarget as HTMLElement).style.textDecoration = "none"; }}
        >
          {e.message}
        </span>
        <button
          style={rowCloseStyle}
          onClick={(ev) => { ev.stopPropagation(); dismissError(i); }}
          title="Dismiss this error"
        >
          &times;
        </button>
      </div>
    );
  };

  return (
    <div style={style}>
      {errors.length > 1 && (
        <div style={{ marginBottom: "4px" }}>{errors.length} validation errors found</div>
      )}
      <div
        ref={scrollRef}
        style={{
          fontSize: "12px",
          ...(expanded && hasOverflow ? { maxHeight: "200px", overflowY: "auto" } : {}),
        }}
      >
        {visibleErrors.map((e, i) => renderErrorRow(e, i))}
      </div>
      {hasOverflow && !expanded && (
        <button
          style={{ ...dismissAllStyle, borderColor: "rgba(114, 28, 36, 0.2)" }}
          onClick={() => setExpanded(true)}
        >
          Show all {errors.length} errors
        </button>
      )}
      {errors.length > 1 && (
        <button style={dismissAllStyle} onClick={dismiss}>
          Dismiss all
        </button>
      )}
    </div>
  );
}
