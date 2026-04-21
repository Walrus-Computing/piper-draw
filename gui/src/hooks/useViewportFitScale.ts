import { useEffect, useState } from "react";

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
        setScale(Math.min(userScale, available / natural));
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
