// ---------------------------------------------------------------------------
// EmbedSnippetPanel — shown under "Export standalone .html" after a successful
// export. Displays the ready-to-paste <iframe> embed snippet with a Copy button.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";

type CopyStatus = "idle" | "copied" | "error";

const COPY_LABEL: Record<CopyStatus, string> = {
  idle: "Copy snippet",
  copied: "Copied ✓",
  error: "Copy failed",
};

const CODE_STYLE: React.CSSProperties = {
  display: "block",
  background: "#f6f6f6",
  border: "1px solid #e0e0e0",
  borderRadius: 3,
  padding: "4px 6px",
  wordBreak: "break-all",
  fontSize: 10.5,
};

export function EmbedSnippetPanel({
  snippet,
  itemStyle,
}: {
  snippet: string;
  itemStyle: React.CSSProperties;
}) {
  // Callers pass key={snippet} so this remounts (resetting status) whenever a
  // new snippet arrives — the "Copied ✓" label never claims a stale snippet.
  const [status, setStatus] = useState<CopyStatus>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear any pending revert timer on unmount (e.g. the key={snippet} remount).
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setStatus("copied");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setStatus("idle"), 1500);
    } catch {
      setStatus("error");
    }
  }

  return (
    <div
      style={{
        borderTop: "1px solid #eee",
        marginTop: 4,
        paddingTop: 6,
        fontSize: 11,
        color: "#444",
      }}
    >
      <div style={{ marginBottom: 4 }}>Embed snippet:</div>
      <code style={CODE_STYLE}>{snippet}</code>
      <button style={{ ...itemStyle, marginTop: 4 }} onClick={() => void copy()}>
        {COPY_LABEL[status]}
      </button>
    </div>
  );
}
