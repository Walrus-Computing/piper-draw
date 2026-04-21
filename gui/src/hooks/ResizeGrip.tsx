// Tiny bottom-right corner grip used by the floating-panel hook. Lives in its
// own file so useFloatingPanel.tsx can export the hook alone (react-refresh /
// Fast Refresh requires component files to export components only).

export function ResizeGrip(props: {
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (e: React.PointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      role="separator"
      aria-label="Resize panel"
      title="Drag to resize"
      {...props}
      style={{
        position: "absolute",
        right: 0,
        bottom: 0,
        width: 14,
        height: 14,
        cursor: "nwse-resize",
        touchAction: "none",
        backgroundImage:
          "linear-gradient(135deg, transparent 0 6px, #999 6px 7px, transparent 7px 10px, #999 10px 11px, transparent 11px)",
        borderBottomRightRadius: 8,
        zIndex: 1,
      }}
    />
  );
}
