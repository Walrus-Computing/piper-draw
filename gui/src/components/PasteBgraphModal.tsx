// ---------------------------------------------------------------------------
// BgraphImportModal — unified Load/Insert modal for bgraph. Accepts both a
// file pick and a paste-from-clipboard textarea as input sources. Caller
// picks the mode (load = replace, insert = add); modal title and submit
// label reflect it.
//
// Why one modal for both sources: paste and load-from-file are the same
// underlying action (parse a bgraph string → blocks Map → store). Giving
// them a single surface keeps the (action × source) grid honest and shrinks
// the Import ▾ menu from 3 bgraph items to 2.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { panelTitle, primaryBtn, secondaryBtn } from "./menuStyles";

const MAX_BYTES = 5 * 1024 * 1024;
const PLACEHOLDER = `BLOCKGRAPH 0.1.0;

METADATA: attr_name; value;
...`;

export type ImportMode = "load" | "insert";

interface Props {
  open: boolean;
  mode: ImportMode;
  onClose: () => void;
  onSubmit: (bgraph: string, mode: ImportMode) => Promise<void> | void;
  externalError?: string | null;
}

const BACKDROP_STYLE: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(11, 10, 9, 0.28)",
  backdropFilter: "blur(2px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 2000,
};

const PANEL_STYLE: React.CSSProperties = {
  width: 600,
  height: 460,
  maxWidth: "calc(100vw - 32px)",
  boxSizing: "border-box",
  background: "var(--pd-panel)",
  border: "1px solid var(--pd-rule)",
  borderRadius: 12,
  boxShadow: "0 16px 48px rgba(11, 10, 9, 0.16)",
  padding: "22px 24px",
  display: "flex",
  flexDirection: "column",
  gap: 12,
  color: "var(--pd-body)",
};

function SizeIndicator({ byteSize, overCap }: { byteSize: number; overCap: boolean }) {
  return (
    <div style={{ fontSize: 11, color: overCap ? "#c00" : "var(--pd-muted)" }}>
      {(byteSize / 1024).toFixed(1)} KB / 5 MB
      {overCap && " — Pasted text exceeds 5 MB cap"}
    </div>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <div
      role="alert"
      style={{
        fontSize: 12,
        color: "#c00",
        border: "1px solid #c00",
        borderRadius: 4,
        padding: "6px 8px",
        background: "#fff5f5",
      }}
    >
      {message}
    </div>
  );
}

function FileSourceRow({
  onPickFile,
  pickedName,
}: {
  onPickFile: () => void;
  pickedName: string | null;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 12px",
        background: "var(--pd-panel-2)",
        border: "1px solid var(--pd-rule-soft)",
        borderRadius: 8,
        fontSize: 12.5,
      }}
    >
      <button
        onClick={onPickFile}
        style={{ ...secondaryBtn(), fontSize: 12.5 }}
      >
        Choose file…
      </button>
      <span style={{ color: "var(--pd-body)" }}>
        {pickedName ? pickedName : "or paste the bgraph below"}
      </span>
    </div>
  );
}

function FooterButtons({
  mode,
  disabled,
  submitting,
  onCancel,
  onSubmit,
}: {
  mode: ImportMode;
  disabled: boolean;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const label = mode === "load" ? "Load" : "Insert";
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
      <button
        onClick={onCancel}
        style={secondaryBtn()}
      >
        Cancel
      </button>
      <button
        onClick={onSubmit}
        disabled={disabled}
        style={primaryBtn(disabled)}
        title={`${label} (⌘/Ctrl+Enter)`}
      >
        {submitting ? `${label}ing…` : label}
      </button>
    </div>
  );
}

const TEXTAREA_STYLE: React.CSSProperties = {
  flex: 1,
  fontFamily: "var(--pd-mono)",
  fontSize: 12,
  padding: 10,
  border: "1px solid var(--pd-rule)",
  borderRadius: 8,
  resize: "none",
  lineHeight: 1.5,
};

interface BodyProps {
  title: string;
  text: string;
  setText: (v: string) => void;
  pickedName: string | null;
  setPickedName: (v: string | null) => void;
  byteSize: number;
  overCap: boolean;
  disabled: boolean;
  submitting: boolean;
  mode: ImportMode;
  error: string | null;
  onClose: () => void;
  submit: () => void;
  setLocalError: (v: string | null) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

function ModalBody({
  title,
  text,
  setText,
  pickedName,
  setPickedName,
  byteSize,
  overCap,
  disabled,
  submitting,
  mode,
  error,
  onClose,
  submit,
  setLocalError,
  textareaRef,
}: BodyProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const handleFile = async (file: File) => {
    setPickedName(file.name);
    setText(await file.text());
    setLocalError(null);
  };
  return (
    <div style={PANEL_STYLE}>
      <div style={{ ...panelTitle, fontSize: 17 }}>{title}</div>
      <FileSourceRow
        onPickFile={() => fileInputRef.current?.click()}
        pickedName={pickedName}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".bgraph"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = "";
        }}
      />
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (pickedName) setPickedName(null);
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={PLACEHOLDER}
        spellCheck={false}
        style={TEXTAREA_STYLE}
      />
      <SizeIndicator byteSize={byteSize} overCap={overCap} />
      {error && <InlineError message={error} />}
      <FooterButtons
        mode={mode}
        disabled={disabled}
        submitting={submitting}
        onCancel={onClose}
        onSubmit={submit}
      />
    </div>
  );
}

export function BgraphImportModal({ open, mode, onClose, onSubmit, externalError }: Props) {
  const [text, setText] = useState("");
  const [pickedName, setPickedName] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => textareaRef.current?.focus());
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const byteSize = new TextEncoder().encode(text).length;
  const overCap = byteSize > MAX_BYTES;
  const disabled = submitting || text.trim().length === 0 || overCap;
  const error = localError ?? externalError ?? null;
  const title = mode === "load" ? "Load bgraph" : "Insert bgraph";

  const submit = () => {
    if (disabled) return;
    setSubmitting(true);
    setLocalError(null);
    Promise.resolve(onSubmit(text, mode))
      .catch((e) => setLocalError(e instanceof Error ? e.message : String(e)))
      .finally(() => setSubmitting(false));
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={BACKDROP_STYLE}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <ModalBody
        title={title}
        text={text}
        setText={setText}
        pickedName={pickedName}
        setPickedName={setPickedName}
        byteSize={byteSize}
        overCap={overCap}
        disabled={disabled}
        submitting={submitting}
        mode={mode}
        error={error}
        onClose={onClose}
        submit={submit}
        setLocalError={setLocalError}
        textareaRef={textareaRef}
      />
    </div>
  );
}

// Backwards-compatible export name (legacy callers used PasteBgraphModal).
// Once nothing imports this name, drop the alias.
export const PasteBgraphModal = BgraphImportModal;
