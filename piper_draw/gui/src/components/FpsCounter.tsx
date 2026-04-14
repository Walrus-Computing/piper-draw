import { useRef } from "react";
import { useFrame } from "@react-three/fiber";

/** DOM ref-based FPS display — updates via direct DOM mutation, never triggers React re-renders. */
export function FpsDisplay({ spanRef }: { spanRef: React.RefObject<HTMLSpanElement | null> }) {
  return (
    <span
      ref={spanRef}
      style={{
        color: "#555",
        fontSize: "13px",
        fontFamily: "monospace",
        userSelect: "none",
      }}
    >
      0 FPS
    </span>
  );
}

export function FpsSampler({ targetRef }: { targetRef: React.RefObject<HTMLSpanElement | null> }) {
  const frames = useRef(0);
  const lastTime = useRef(performance.now());

  useFrame(() => {
    frames.current++;
    const now = performance.now();
    const delta = now - lastTime.current;
    if (delta >= 500) {
      const fps = Math.round((frames.current * 1000) / delta);
      if (targetRef.current) targetRef.current.textContent = `${fps} FPS`;
      frames.current = 0;
      lastTime.current = now;
    }
  });

  return null;
}
