import { useEffect } from "react";
import * as THREE from "three";
import { useBlockStore } from "../stores/blockStore";
import { useKeybindStore } from "../stores/keybindStore";

export function NavControlsModifier({
  controlsRef,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  controlsRef: React.RefObject<any>;
}) {
  const mode = useBlockStore((s) => s.mode);
  const navStyle = useKeybindStore((s) => s.navStyle);

  useEffect(() => {
    // OrbitControls auto-swaps LEFT between ROTATE and PAN when Shift/Ctrl/Meta
    // is held: if LEFT=PAN, Shift makes it ROTATE; if LEFT=ROTATE, Shift makes
    // it PAN. Alt is NOT part of that swap, so in the "pan" navStyle we set
    // LEFT explicitly while Alt is held to expose Alt+Drag = rotate.
    const apply = (alt: boolean) => {
      const controls = controlsRef.current;
      if (!controls || !controls.mouseButtons) return;
      if (mode === "select") {
        controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
        return;
      }
      if (navStyle === "rotate") {
        // Drag = rotate, Shift+Drag = pan (handled by OrbitControls' built-in swap).
        controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
      } else {
        // Drag = pan, Shift+Drag = rotate (built-in swap), Alt+Drag = rotate (manual).
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
  }, [mode, navStyle, controlsRef]);

  return null;
}
