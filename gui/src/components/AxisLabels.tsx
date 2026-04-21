import { Line } from "@react-three/drei";

const AXIS_LENGTH = 10000;
const ORIGIN: [number, number, number] = [0, 0, 0];

const axes: { key: string; color: string; end: [number, number, number] }[] = [
  { key: "X", color: "#ff7f7f", end: [AXIS_LENGTH, 0, 0] },
  { key: "Y", color: "#44cc44", end: [0, 0, -AXIS_LENGTH] },
  { key: "Z", color: "#7396ff", end: [0, AXIS_LENGTH, 0] },
];

export function AxisLabels() {
  return (
    <group>
      {axes.map(({ key, color, end }) => (
        <Line key={key} points={[ORIGIN, end]} color={color} lineWidth={2} />
      ))}
    </group>
  );
}
