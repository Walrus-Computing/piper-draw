import { Html, Line } from "@react-three/drei";

const AXIS_LENGTH = 20;
const ORIGIN: [number, number, number] = [0, 0, 0];

const axes: { label: string; color: string; end: [number, number, number] }[] = [
  { label: "X", color: "#ff4444", end: [AXIS_LENGTH, 0, 0] },
  { label: "Y", color: "#44cc44", end: [0, 0, -AXIS_LENGTH] },
  { label: "Z", color: "#4488ff", end: [0, AXIS_LENGTH, 0] },
];

export function AxisLabels() {
  return (
    <group>
      {axes.map(({ label, color, end }) => (
        <group key={label}>
          <Line points={[ORIGIN, end]} color={color} lineWidth={2} />
          <Html
            position={end}
            center
            style={{
              color,
              fontSize: "14px",
              fontWeight: "bold",
              fontFamily: "sans-serif",
              pointerEvents: "none",
              userSelect: "none",
            }}
          >
            {label}
          </Html>
        </group>
      ))}
    </group>
  );
}
