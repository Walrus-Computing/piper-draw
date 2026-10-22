// ---------------------------------------------------------------------------
// BgraphGalleryPanel — floating panel listing pre-bundled .bgraph examples.
// Design pick 3 (CEO plan).
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { useFloatingPanel } from "../hooks/useFloatingPanel";
import { ResizeGrip } from "../hooks/ResizeGrip";
import type { ImportMode } from "./PasteBgraphModal";
import { FLOAT_PANEL, PANEL_HEADER, closeBtn, primaryBtn, secondaryBtn } from "./menuStyles";

interface ManifestEntry {
  name: string;
  description: string;
  filename: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onLoad: (bgraph: string, name: string, mode: ImportMode) => Promise<void> | void;
}

function GalleryHeader({ onClose }: { onClose: () => void }) {
  return (
    <>
      <span>Examples</span>
      <button
        onClick={onClose}
        aria-label="Close panel"
        style={closeBtn}
      >
        ✕
      </button>
    </>
  );
}

function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div style={{ padding: "16px", textAlign: "center", color: "var(--pd-body)" }}>
      <div style={{ fontSize: 12, marginBottom: 8 }}>Could not load examples</div>
      <div style={{ fontSize: 10, marginBottom: 8, color: "var(--pd-muted)" }}>{error}</div>
      <button
        onClick={onRetry}
        style={{ ...secondaryBtn(), fontSize: 12 }}
      >
        Retry
      </button>
    </div>
  );
}

function GalleryRow({
  entry,
  busy,
  onLoad,
}: {
  entry: ManifestEntry;
  busy: boolean;
  onLoad: (entry: ManifestEntry, mode: ImportMode) => void;
}) {
  return (
    <div
      onClick={() => onLoad(entry, "load")}
      title="Click to load (replaces scene); use + to insert next to scene"
      style={{
        padding: "10px 14px",
        borderBottom: "1px solid var(--pd-rule-soft)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        cursor: busy ? "default" : "pointer",
        opacity: busy ? 0.6 : 1,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 500, fontSize: 13.5, color: "var(--pd-ink)" }}>{entry.name}</div>
        <div style={{ fontSize: 12, color: "var(--pd-body)", marginTop: 2, lineHeight: 1.45 }}>{entry.description}</div>
      </div>
      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onLoad(entry, "load");
          }}
          disabled={busy}
          title={`Load (replace scene): ${entry.name}`}
          style={{ ...primaryBtn(busy), padding: "3px 12px", fontSize: 12 }}
        >
          Load
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onLoad(entry, "insert");
          }}
          disabled={busy}
          title={`Insert next to current scene: ${entry.name}`}
          style={{ ...secondaryBtn(busy), padding: "3px 9px", fontSize: 12 }}
        >
          +
        </button>
      </div>
    </div>
  );
}

type FetchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: ManifestEntry[] }
  | { status: "error"; message: string };

function useManifestFetch(open: boolean, fetchKey: number): FetchState {
  const [state, setState] = useState<FetchState>({ status: "idle" });

  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on close is the desired behavior
      setState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    fetch("/bgraph-examples/manifest.json")
      .then((res) => {
        if (!res.ok) throw new Error(`Server error: ${res.status}`);
        return res.json() as Promise<ManifestEntry[]>;
      })
      .then((data) => {
        if (!cancelled) setState({ status: "ready", data });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: e instanceof Error ? e.message : String(e),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, fetchKey]);

  return state;
}

const PANEL_BG_STYLE: React.CSSProperties = {
  ...FLOAT_PANEL,
  display: "flex",
  flexDirection: "column",
  zIndex: 1500,
};

const HEADER_INNER_STYLE: React.CSSProperties = PANEL_HEADER;

const FOOTER_STYLE: React.CSSProperties = {
  padding: "8px 14px",
  borderTop: "1px solid var(--pd-rule-soft)",
  fontSize: 11,
  color: "var(--pd-muted)",
};

function GalleryBody({
  state,
  busy,
  onLoadEntry,
  onRetry,
}: {
  state: FetchState;
  busy: boolean;
  onLoadEntry: (e: ManifestEntry, mode: ImportMode) => void;
  onRetry: () => void;
}) {
  if (state.status === "error") return <ErrorState error={state.message} onRetry={onRetry} />;
  if (state.status !== "ready") {
    return (
      <div style={{ padding: "16px", textAlign: "center", color: "var(--pd-muted)", fontSize: 12 }}>
        Loading…
      </div>
    );
  }
  return (
    <>
      {state.data.map((entry) => (
        <GalleryRow key={entry.filename} entry={entry} busy={busy} onLoad={onLoadEntry} />
      ))}
    </>
  );
}

export function BgraphGalleryPanel({ open, onClose, onLoad }: Props) {
  const { containerStyle, dragHandleProps, resizeGripProps } = useFloatingPanel({
    id: "bgraph-gallery",
    defaultGeometry: { x: 80, y: 80, width: 400, height: 360 },
    minWidth: 320,
    minHeight: 240,
  });
  const [fetchKey, setFetchKey] = useState(0);
  const state = useManifestFetch(open, fetchKey);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const loadExample = async (entry: ManifestEntry, mode: ImportMode) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/bgraph-examples/${entry.filename}`);
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      await onLoad(await res.text(), entry.name, mode);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="dialog" aria-label="Bgraph examples" style={{ ...containerStyle, ...PANEL_BG_STYLE }}>
      <div {...dragHandleProps} style={{ ...dragHandleProps.style, ...HEADER_INNER_STYLE }}>
        <GalleryHeader onClose={onClose} />
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
        <GalleryBody
          state={state}
          busy={busy}
          onLoadEntry={(e, mode) => void loadExample(e, mode)}
          onRetry={() => setFetchKey((k) => k + 1)}
        />
      </div>
      <div style={FOOTER_STYLE}>Add your own at gui/public/bgraph-examples/</div>
      <ResizeGrip {...resizeGripProps} />
    </div>
  );
}
