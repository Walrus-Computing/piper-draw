import { useCallback, useMemo, useState } from "react";
import * as THREE from "three";
import { useBlockStore } from "../stores/blockStore";
import { useLocateStore } from "../stores/locateStore";
import { getAllPortPositions, posKey, tqecToThree, type Position3D } from "../types";
import { animateCamera } from "../utils/cameraAnim";

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
  const [prevLabel, setPrevLabel] = useState(label);

  if (label !== prevLabel) {
    setPrevLabel(label);
    setDraft(label);
  }

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

function LocateIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="8" cy="8" r="1" fill="currentColor" />
      <line x1="8" y1="1" x2="8" y2="3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="8" y1="12.5" x2="8" y2="15" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="1" y1="8" x2="3.5" y2="8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="12.5" y1="8" x2="15" y2="8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function PortsTable({
  controlsRef,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  controlsRef: React.RefObject<any>;
}) {
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

  const handleLocate = useCallback(
    (pos: Position3D) => {
      const controls = controlsRef.current;
      if (controls) {
        const [tx, ty, tz] = tqecToThree(pos, "XZZ");
        const camera = controls.object as THREE.PerspectiveCamera;
        const endTarget = new THREE.Vector3(tx, ty, tz);
        const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
        const endPos = endTarget.clone().add(offset);
        animateCamera(controls, endTarget, endPos, { duration: 400 });
      }
      useLocateStore.getState().setPulse(posKey(pos));
    },
    [controlsRef],
  );

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
          <button
            type="button"
            onClick={() => handleLocate(pos)}
            aria-label="Locate port"
            title="Locate port"
            style={{
              background: "none",
              border: "none",
              padding: 2,
              cursor: "pointer",
              color: "#666",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <LocateIcon />
          </button>
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
            title={`(${pos.x / 3}, ${pos.y / 3}, ${pos.z / 3})`}
            style={{ color: "#aaa", fontFamily: "monospace", fontSize: 10 }}
          >
            {pos.x / 3},{pos.y / 3},{pos.z / 3}
          </span>
        </div>
      ))}
    </section>
  );
}
