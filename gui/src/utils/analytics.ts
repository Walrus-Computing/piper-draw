/**
 * Anonymous usage analytics (umami).
 *
 * The tracker script is served first-party from the backend (`/pd.js`, see
 * `server.py`) and posts to `/api/send`, which the backend forwards to umami
 * cloud — so hostname-based blocklists don't zero out the numbers.
 *
 * Consent-free by design: no cookies, no stored identifiers, and event
 * payloads must never contain scene contents, filenames, or anything the
 * user typed. Keep it that way — a single identifying field would put the
 * whole setup into consent-banner territory.
 */

type EventData = Record<string, string | number | boolean>;

declare global {
  interface Window {
    umami?: { track: (name: string, data?: EventData) => void };
  }
}

/**
 * Record a named event. No-ops when the tracker is absent (dev builds,
 * ad-blocked script, tests) — analytics must never break the app.
 */
export function track(name: string, data?: EventData): void {
  try {
    window.umami?.track(name, data);
  } catch {
    // Swallow: a failing tracker is strictly less important than the app.
  }
}

export const HEARTBEAT_INTERVAL_MS = 60_000;

/**
 * Emit a `heartbeat` event once per minute while the tab is visible AND the
 * user interacted (pointer/key/wheel) during that minute. umami derives
 * visit duration from the time span between events, so without this a
 * single-page session of hours reads as ~0s; with it, "average visit time"
 * becomes active editing time (idle or backgrounded tabs don't count).
 *
 * Returns a stop function (used by tests; the app runs it for the page's
 * lifetime).
 */
export function startHeartbeat(): () => void {
  let sawActivity = false;
  const markActive = () => {
    sawActivity = true;
  };
  const opts = { passive: true, capture: true } as const;
  window.addEventListener("pointerdown", markActive, opts);
  window.addEventListener("keydown", markActive, opts);
  window.addEventListener("wheel", markActive, opts);
  const timer = setInterval(() => {
    if (sawActivity && document.visibilityState === "visible") track("heartbeat");
    sawActivity = false;
  }, HEARTBEAT_INTERVAL_MS);
  return () => {
    clearInterval(timer);
    window.removeEventListener("pointerdown", markActive, opts);
    window.removeEventListener("keydown", markActive, opts);
    window.removeEventListener("wheel", markActive, opts);
  };
}
