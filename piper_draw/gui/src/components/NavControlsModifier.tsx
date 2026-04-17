import { useEffect } from "react";
import * as THREE from "three";
import { useBlockStore } from "../stores/blockStore";

export function NavControlsModifier({
  controlsRef,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  controlsRef: React.RefObject<any>;
}) {
  const mode = useBlockStore((s) => s.mode);

  useEffect(() => {
    // Note: OrbitControls internally swaps LEFT between ROTATE <-> PAN when
    // Shift/Ctrl/Meta is held. So for Shift+drag=rotate to work, we leave
    // LEFT=PAN and let OrbitControls do the swap. Alt is NOT part of that
    // swap, so we explicitly set LEFT=ROTATE while Alt is held.
    const apply = (alt: boolean) => {
      const controls = controlsRef.current;
      if (!controls || !controls.mouseButtons) return;
      if (mode === "select") {
        controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
      } else {
        controls.mouseButtons.LEFT = alt ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
      }
    };

    let alt = false;
    apply(alt);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Alt") return;
      alt = true;
      apply(alt);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== "Alt") return;
      alt = false;
      apply(alt);
    };
    const onBlur = () => {
      alt = false;
      apply(alt);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [mode, controlsRef]);

  return null;
}
