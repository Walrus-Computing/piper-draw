import { useEffect, useState } from "react";
import { useValidationStore } from "../stores/validationStore";

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
  cursor: "pointer",
  maxWidth: "500px",
  textAlign: "center" as const,
};

const styleVariants: Record<string, React.CSSProperties> = {
  loading: { background: "#e8f0fe", color: "#1a56db", cursor: "default" },
  valid: { background: "#d4edda", color: "#155724", border: "1px solid #c3e6cb" },
  invalid: { background: "#f8d7da", color: "#721c24", border: "1px solid #f5c6cb" },
  error: { background: "#fff3cd", color: "#856404", border: "1px solid #ffeeba" },
};

export function ValidationToast({ toolbarRef }: { toolbarRef: React.RefObject<HTMLDivElement | null> }) {
  const status = useValidationStore((s) => s.status);
  const errors = useValidationStore((s) => s.errors);
  const dismiss = useValidationStore((s) => s.dismiss);
  const [topOffset, setTopOffset] = useState(0);

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

  if (status === "idle") return null;

  const variantKey = status === "invalid" && errors.some((e) => e.message.includes("not available")) ? "error" : status;
  const style = { ...baseStyle, ...styleVariants[variantKey], top: topOffset };

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

  const summary =
    errors.length === 1
      ? errors[0].message
      : `${errors.length} validation errors found. Click to dismiss.`;

  return (
    <div style={style} onClick={dismiss}>
      {summary}
      {errors.length > 1 && (
        <ul style={{ margin: "4px 0 0", padding: "0 0 0 16px", textAlign: "left", fontSize: "12px" }}>
          {errors.slice(0, 5).map((e, i) => (
            <li key={i}>{e.message}</li>
          ))}
          {errors.length > 5 && <li>...and {errors.length - 5} more</li>}
        </ul>
      )}
    </div>
  );
}
