export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
export const modKey = isMac ? "\u2318" : "Ctrl+";
export const altKey = isMac ? "⌥ Option+" : "Alt+";
