import { useMemo } from "react";
import * as THREE from "three";

const ORIGIN = new THREE.Vector3(0, 0, 0);

const AXES: { dir: THREE.Vector3; color: number; label: string }[] = [
  { dir: new THREE.Vector3(1, 0, 0), color: 0xff4444, label: "X" },
  { dir: new THREE.Vector3(0, 0, -1), color: 0x44cc44, label: "Y" },
  { dir: new THREE.Vector3(0, 1, 0), color: 0x4488ff, label: "Z" },
];

function SpriteLabel({
  position,
  text,
  color,
}: {
  position: [number, number, number];
  text: string;
  color: string;
}) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    ctx.font = "bold 48px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = color;
    ctx.fillText(text, 32, 32);
    return new THREE.CanvasTexture(canvas);
  }, [text, color]);

  return (
    <sprite position={position} scale={[0.25, 0.25, 1]}>
      <spriteMaterial map={texture} transparent depthTest={false} />
    </sprite>
  );
}

export function OrientationGizmo() {
  const arrows = useMemo(
    () =>
      AXES.map(
        ({ dir, color }) =>
          new THREE.ArrowHelper(dir, ORIGIN, 0.65, color, 0.2, 0.12),
      ),
    [],
  );

  return (
    <group scale={40}>
      {arrows.map((arrow, i) => {
        const { dir, color, label } = AXES[i];
        const hex = "#" + color.toString(16).padStart(6, "0");
        return (
          <group key={label}>
            <primitive object={arrow} />
            <SpriteLabel
              position={[dir.x * 0.95, dir.y * 0.95, dir.z * 0.95]}
              text={label}
              color={hex}
            />
          </group>
        );
      })}
    </group>
  );
}
