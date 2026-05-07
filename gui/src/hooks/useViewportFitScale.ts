import { useEffect, useState } from "react";

// Hysteresis threshold for scale updates. Tiny natural-width oscillations
// from internal text changes (FPS counter, hover position display) would
// otherwise toggle the transform every frame, producing a visible height
// flicker when the window is just narrower than the toolbar's natural width.
// 0.5% is below the noise floor of legitimate fit changes (mode switches,
// selection inspector appearing) and above the FPS / position-text noise.
const SCALE_HYSTERESIS = 0.005;

// Returns a CSS scale factor that keeps an element at `userScale` when it fits
// within the viewport (minus `marginPx` on each side), and shrinks it further
// when it doesn't. `userScale` defaults to 1, matching the original cap.
export function useViewportFitScale(
  ref: React.RefObject<HTMLElement | null>,
  marginPx: number,
  userScale: number = 1,
): number {
  const [scale, setScale] = useState(userScale);
  useEffect(() => {
    let frame = 0;
    const recompute = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const node = ref.current;
        if (!node) return;
        // offsetWidth is the layout (untransformed) width — independent of
        // the scale we apply, so this measurement is stable across renders.
        const natural = node.offsetWidth;
        if (natural === 0) return;
        const available = window.innerWidth - marginPx;
        const target = Math.min(userScale, available / natural);
        setScale((prev) => (Math.abs(target - prev) < SCALE_HYSTERESIS ? prev : target));
      });
    };
    const node = ref.current;
    const ro = node ? new ResizeObserver(recompute) : null;
    if (node && ro) ro.observe(node);
    window.addEventListener("resize", recompute);
    recompute();
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", recompute);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ref, marginPx, userScale]);
  return scale;
}
