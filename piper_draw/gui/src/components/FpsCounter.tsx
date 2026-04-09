import { useRef } from "react";
import { useFrame } from "@react-three/fiber";

export function FpsDisplay({ fps }: { fps: number }) {
  return (
    <div
      style={{
        position: "fixed",
        top: 12,
        right: 16,
        color: "#555",
        fontSize: "13px",
        fontFamily: "monospace",
        userSelect: "none",
        pointerEvents: "none",
        zIndex: 1,
      }}
    >
      {fps} FPS
    </div>
  );
}

export function FpsSampler({ onFps }: { onFps: (fps: number) => void }) {
  const frames = useRef(0);
  const lastTime = useRef(performance.now());
  const onFpsRef = useRef(onFps);
  onFpsRef.current = onFps;

  useFrame(() => {
    frames.current++;
    const now = performance.now();
    const delta = now - lastTime.current;
    if (delta >= 500) {
      onFpsRef.current(Math.round((frames.current * 1000) / delta));
      frames.current = 0;
      lastTime.current = now;
    }
  });

  return null;
}
