import type React from "react";

// Shared look for the toolbar dropdowns (Import, Export, Analyze): one panel,
// flat rows, brand-blue tint for hover (index.css, .pd-menu) and for the active row.

export const MENU_PANEL: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 4px)",
  left: 0,
  background: "var(--pd-panel)",
  border: "1px solid var(--pd-rule)",
  borderRadius: 6,
  boxShadow: "0 6px 20px rgba(11, 10, 9, 0.10)",
  padding: 4,
  zIndex: 1000,
  display: "flex",
  flexDirection: "column",
  gap: 1,
};

export const menuItem = (disabled = false, active = false): React.CSSProperties => ({
  padding: "6px 10px",
  fontSize: 13,
  fontFamily: "inherit",
  textAlign: "left",
  whiteSpace: "nowrap",
  border: "none",
  borderRadius: 4,
  background: active ? "var(--pd-accent-tint)" : "transparent",
  color: disabled ? "var(--pd-muted)" : "var(--pd-ink)",
  opacity: disabled ? 0.55 : 1,
  cursor: disabled ? "default" : "pointer",
});

// Shared pieces for the panels and dialogs behind those menus (Examples, Flows, ZX, Export HTML, bgraph):
// one small-caps section label, one panel title, one primary and one secondary button.

export const sectionLabel: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 500,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--pd-muted)",
};

export const panelTitle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 500,
  letterSpacing: "-0.01em",
  color: "var(--pd-ink)",
};

export const primaryBtn = (disabled = false): React.CSSProperties => ({
  padding: "5px 14px",
  fontSize: 13,
  fontWeight: 500,
  fontFamily: "inherit",
  border: "1px solid transparent",
  borderRadius: 6,
  background: disabled ? "var(--pd-accent-tint)" : "var(--pd-accent)",
  color: disabled ? "var(--pd-muted)" : "#fff",
  cursor: disabled ? "default" : "pointer",
  whiteSpace: "nowrap",
});

export const secondaryBtn = (disabled = false): React.CSSProperties => ({
  padding: "5px 12px",
  fontSize: 13,
  fontFamily: "inherit",
  border: "1px solid var(--pd-rule)",
  borderRadius: 6,
  background: "var(--pd-panel)",
  color: disabled ? "var(--pd-muted)" : "var(--pd-ink)",
  opacity: disabled ? 0.6 : 1,
  cursor: disabled ? "default" : "pointer",
  whiteSpace: "nowrap",
});

// Floating panels (Examples, Flows, ZX) and their draggable header.
export const FLOAT_PANEL: React.CSSProperties = {
  background: "var(--pd-panel)",
  border: "1px solid var(--pd-rule)",
  borderRadius: 12,
  boxShadow: "0 12px 36px rgba(11, 10, 9, 0.12)",
  color: "var(--pd-body)",
  overflow: "hidden",
};

export const PANEL_HEADER: React.CSSProperties = {
  ...panelTitle,
  padding: "10px 14px",
  borderBottom: "1px solid var(--pd-rule-soft)",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 8,
};

export const closeBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "var(--pd-muted)",
  fontSize: 15,
  lineHeight: 1,
  padding: "2px 4px",
};
