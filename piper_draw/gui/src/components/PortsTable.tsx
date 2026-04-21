import { useEffect, useMemo, useState } from "react";
import { useBlockStore } from "../stores/blockStore";
import { getAllPortPositions, posKey, type Position3D } from "../types";

function PortLabelInput({
  pos,
  label,
  onCommit,
}: {
  pos: Position3D;
  label: string;
  onCommit: (pos: Position3D, label: string) => void;
}) {
  const [draft, setDraft] = useState(label);

  useEffect(() => {
    setDraft(label);
  }, [label]);

  const commit = () => {
    if (draft.trim() === label) {
      setDraft(label);
      return;
    }
    onCommit(pos, draft);
  };

  return (
    <input
      type="text"
      value={draft}
      placeholder="label"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          setDraft(label);
          (e.target as HTMLInputElement).blur();
        }
      }}
      style={{
        flex: 1,
        fontSize: 12,
        padding: "2px 6px",
        border: "1px solid #ccc",
        borderRadius: 4,
        fontFamily: "monospace",
      }}
    />
  );
}

export function PortsTable() {
  const blocks = useBlockStore((s) => s.blocks);
  const portMeta = useBlockStore((s) => s.portMeta);
  const portPositions = useBlockStore((s) => s.portPositions);
  const setPortLabel = useBlockStore((s) => s.setPortLabel);
  const setPortIO = useBlockStore((s) => s.setPortIO);

  const portList = useMemo(() => {
    const positions = getAllPortPositions(blocks, portPositions);
    return positions.map((pos) => {
      const key = posKey(pos);
      const meta = portMeta.get(key);
      return { pos, key, meta };
    });
  }, [blocks, portMeta, portPositions]);

  return (
    <section>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>
        Ports ({portList.length})
      </div>
      {portList.length === 0 && (
        <div style={{ color: "#888" }}>
          No open ports. Add open pipes or place port markers.
        </div>
      )}
      {portList.map(({ pos, key, meta }) => (
        <div
          key={key}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginBottom: 4,
          }}
        >
          <PortLabelInput
            pos={pos}
            label={meta?.label ?? ""}
            onCommit={setPortLabel}
          />
          <select
            value={meta?.io ?? "in"}
            onChange={(e) => setPortIO(pos, e.target.value as "in" | "out")}
            style={{ fontSize: 12, padding: "2px 4px" }}
          >
            <option value="in">in</option>
            <option value="out">out</option>
          </select>
          <span
            title={`(${pos.x}, ${pos.y}, ${pos.z})`}
            style={{ color: "#aaa", fontFamily: "monospace", fontSize: 10 }}
          >
            {pos.x},{pos.y},{pos.z}
          </span>
        </div>
      ))}
    </section>
  );
}
