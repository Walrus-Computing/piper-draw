/**
 * EquisetaMenu — top-level Toolbar dropdown for the Equiseta JSON viewer.
 *
 * Matches the visual pattern of FileMenu (`Toolbar.tsx:1138-1410`) but lives
 * in its own file per CLAUDE.md "don't grow Toolbar.tsx". Two responsibilities:
 *
 *   1. "Open JSON…" — opens the file picker (via `loadEquisetaViaPicker`),
 *      panel auto-opens on success.
 *   2. Bundled examples — lazy-fetches `equiseta-examples/manifest.json` on
 *      first dropdown open, lists 9 examples. Click loads the fixture into
 *      the panel.
 *
 * Manifest-fetch failure UX (Hardening row #4): falls back to a hardcoded
 * filename list so the dropdown is never dead, plus a "Retry" item that
 * re-attempts the fetch.
 */

import { useEffect, useRef, useState } from "react";
import { useBlockStore } from "../stores/blockStore";
import {
  fetchEquisetaManifest,
  type ManifestGroup,
} from "../utils/equisetaJsonLoad";
import {
  loadEquisetaFixture,
  loadEquisetaViaPicker,
} from "../utils/equisetaJsonController";

// Filename list for the manifest-fetch-failure fallback. Names are
// derived from the filename so the dropdown is usable even with no
// descriptions. Kept flat (no grouping) since the failure path is already
// a degraded experience — extra structure would just be noise.
const FALLBACK_FILENAMES = [
  "all_open.json",
  "all_red.json",
  "all_blue.json",
  "zxx_memory.json",
  "xzz_memory.json",
  "hadamard_top.json",
  "port_io.json",
  "y_defect_ridges.json",
  "blue_pair_east_west.json",
  "red_pair_east_west.json",
  "zxx_memory_pair.json",
  "xzz_memory_pair.json",
  "zxx_time_evolution.json",
  "hadamard_pipe.json",
  "port_io_pair.json",
  "disconnected_pair.json",
  "koval_q_couch_cnot.json",
];

function nameFromFilename(filename: string): string {
  return filename.replace(/\.json$/, "").replace(/_/g, " ");
}

const dropdownItemStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "5px 12px",
  fontSize: 12,
  fontFamily: "sans-serif",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  color: "#222",
};

const dropdownItemHoverStyle: React.CSSProperties = {
  background: "#f0f4ff",
};

interface DropdownItemProps {
  label: string;
  description?: string;
  onClick: () => void;
  disabled?: boolean;
}

function DropdownItem({ label, description, onClick, disabled }: DropdownItemProps) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={() => {
        if (!disabled) onClick();
      }}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...dropdownItemStyle,
        ...(hover && !disabled ? dropdownItemHoverStyle : {}),
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? "default" : "pointer",
      }}
    >
      <div style={{ fontWeight: 500 }}>{label}</div>
      {description && (
        <div style={{ fontSize: 10, color: "#666", marginTop: 1 }}>{description}</div>
      )}
    </button>
  );
}

function MenuButton({
  open,
  panelOpen,
  onToggle,
}: {
  open: boolean;
  panelOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      title="Open the Equiseta JSON viewer"
      aria-haspopup="menu"
      aria-expanded={open}
      style={{
        padding: "4px 12px",
        fontSize: 13,
        fontFamily: "sans-serif",
        cursor: "pointer",
        border: panelOpen ? "2px solid #4a9eff" : "2px solid #ccc",
        borderRadius: 4,
        background: panelOpen ? "#e8f0fe" : "#fff",
      }}
    >
      Equiseta {open ? "▴" : "▾"}
    </button>
  );
}

const groupLabelStyle: React.CSSProperties = {
  fontSize: 10,
  color: "#888",
  padding: "4px 12px 2px 18px",
  fontWeight: "bold",
  letterSpacing: "0.4px",
};

function GroupedExamples({
  groups,
  onPick,
}: {
  groups: ManifestGroup[];
  onPick: (filename: string, displayName: string) => void;
}) {
  return (
    <>
      {groups.map((group, gi) => (
        <div key={`${group.label}-${gi}`}>
          {group.label !== "" && <div style={groupLabelStyle}>{group.label.toUpperCase()}</div>}
          {group.examples.map((entry) => (
            <DropdownItem
              key={entry.filename}
              label={entry.name}
              description={entry.description}
              onClick={() => onPick(entry.filename, entry.name)}
            />
          ))}
        </div>
      ))}
    </>
  );
}

function ExamplesSection({
  manifestLoading,
  manifestError,
  groups,
  onPick,
  onRetry,
}: {
  manifestLoading: boolean;
  manifestError: string | null;
  groups: ManifestGroup[] | null;
  onPick: (filename: string, displayName: string) => void;
  onRetry: () => void;
}) {
  if (manifestLoading) {
    return (
      <div style={{ padding: "5px 12px", fontSize: 12, color: "#666" }} data-testid="manifest-loading">
        Loading…
      </div>
    );
  }
  if (manifestError) {
    return (
      <>
        {FALLBACK_FILENAMES.map((filename) => (
          <DropdownItem
            key={filename}
            label={nameFromFilename(filename)}
            description={`(fallback) ${filename}`}
            onClick={() => onPick(filename, nameFromFilename(filename))}
          />
        ))}
        <div style={{ borderTop: "1px solid #eee", margin: "4px 0" }} />
        <DropdownItem
          label="↻ Retry loading manifest"
          description={`Last error: ${manifestError}`}
          onClick={onRetry}
        />
      </>
    );
  }
  if (groups) {
    return <GroupedExamples groups={groups} onPick={onPick} />;
  }
  return null;
}

function DropdownPanel({
  manifestLoading,
  manifestError,
  groups,
  onOpenPicker,
  onPick,
  onRetry,
}: {
  manifestLoading: boolean;
  manifestError: string | null;
  groups: ManifestGroup[] | null;
  onOpenPicker: () => void;
  onPick: (filename: string, displayName: string) => void;
  onRetry: () => void;
}) {
  return (
    <div
      role="menu"
      data-testid="equiseta-dropdown"
      style={{
        position: "absolute",
        top: "100%",
        left: 0,
        marginTop: 4,
        minWidth: 280,
        maxHeight: 480,
        overflowY: "auto",
        background: "#fff",
        border: "1px solid #ccc",
        borderRadius: 6,
        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        zIndex: 100,
      }}
    >
      <DropdownItem
        label="Open JSON…"
        description="Pick a JSON file from disk"
        onClick={onOpenPicker}
      />
      <div style={{ borderTop: "1px solid #eee", margin: "4px 0" }} />
      <div
        style={{
          fontSize: 10,
          color: "#888",
          padding: "2px 12px",
          fontWeight: "bold",
          letterSpacing: "0.4px",
        }}
      >
        EXAMPLES
      </div>
      <ExamplesSection
        manifestLoading={manifestLoading}
        manifestError={manifestError}
        groups={groups}
        onPick={onPick}
        onRetry={onRetry}
      />
    </div>
  );
}

export function EquisetaMenu() {
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<ManifestGroup[] | null>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [manifestLoading, setManifestLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const panelOpen = useBlockStore((s) => s.equisetaPanelOpen);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const fetchManifest = async () => {
    setManifestLoading(true);
    setManifestError(null);
    const r = await fetchEquisetaManifest();
    setManifestLoading(false);
    if (r.ok) setGroups(r.groups);
    else {
      setManifestError(r.message);
      console.error("EquisetaMenu: manifest fetch failed:", r.message);
    }
  };

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && groups === null && manifestError === null && !manifestLoading) {
      await fetchManifest();
    }
  };

  const onPick = async (filename: string, displayName: string) => {
    setOpen(false);
    await loadEquisetaFixture(filename, displayName);
  };

  const onOpenPicker = async () => {
    setOpen(false);
    await loadEquisetaViaPicker();
  };

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-block" }}>
      <MenuButton open={open} panelOpen={panelOpen} onToggle={toggle} />
      {open && (
        <DropdownPanel
          manifestLoading={manifestLoading}
          manifestError={manifestError}
          groups={groups}
          onOpenPicker={onOpenPicker}
          onPick={onPick}
          onRetry={fetchManifest}
        />
      )}
    </div>
  );
}
