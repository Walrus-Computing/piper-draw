export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
export const altKey = isMac ? "⌥ Option+" : "Alt+";
