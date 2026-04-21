import { useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

// Shared pulse parameters so every pulsing element looks the same.
// Range: PULSE_BASE ± PULSE_AMPLITUDE = 1.02–1.18 — never below 1.02
// so the highlight always stays larger than the underlying block.
export const PULSE_BASE = 1.1;
export const PULSE_AMPLITUDE = 0.08;
export const PULSE_SPEED = 3;

export function usePulseScale(
  base = PULSE_BASE,
  amplitude = PULSE_AMPLITUDE,
  speed = PULSE_SPEED,
) {
  const groupRef = useRef<THREE.Group>(null!);
  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const s = base + amplitude * Math.sin(clock.getElapsedTime() * speed);
    groupRef.current.scale.setScalar(s);
  });
  return groupRef;
}
