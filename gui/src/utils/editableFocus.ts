/**
 * True when the user is typing into a form field or contenteditable region —
 * global keyboard shortcuts should bail in that case so the input behaves
 * normally (typing, arrow-key cursor movement, etc.).
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}
