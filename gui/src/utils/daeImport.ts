import type { Block, BlockType, CubeType, Position3D } from "../types";
import { CUBE_TYPES, PIPE_TYPES, posKey, isPipeType, determineCubeOptions, countAttachedPipes } from "../types";
import {
  adjustHadamardDirection,
  getAxesDirections,
  isIdentityRotation,
  pipeDirectionIndex,
  rotateBlockKind,
} from "./blockRotation";
import { toastBus } from "./toastBus";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALL_BLOCK_TYPES: ReadonlySet<string> = new Set([
  ...CUBE_TYPES,
  ...PIPE_TYPES,
  "Y",
]);

// ---------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------

/** Find child elements by local name (namespace-agnostic). */
function childrenByLocalName(el: Element, localName: string): Element[] {
  const result: Element[] = [];
  for (let i = 0; i < el.children.length; i++) {
    if (el.children[i].localName === localName) result.push(el.children[i]);
  }
  return result;
}

function firstChildByLocalName(el: Element, localName: string): Element | null {
  for (let i = 0; i < el.children.length; i++) {
    if (el.children[i].localName === localName) return el.children[i];
  }
  return null;
}

/** Recursively find all elements with a given local name. */
function findAllByLocalName(root: Element, localName: string): Element[] {
  const result: Element[] = [];
  const stack: Element[] = [root];
  while (stack.length > 0) {
    const el = stack.pop()!;
    if (el.localName === localName) result.push(el);
    for (let i = 0; i < el.children.length; i++) stack.push(el.children[i]);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Matrix decomposition
// ---------------------------------------------------------------------------

/** Parse a 4x4 matrix from a space-separated string of 16 floats (row-major). */
function parseMatrix4x4(text: string): number[] {
  const vals = text.trim().split(/\s+/).map(Number);
  if (vals.length !== 16) throw new Error(`Expected 16 matrix values, got ${vals.length}`);
  return vals;
}

/** Extract translation from a row-major 4x4 matrix. */
function getTranslation(mat: number[]): [number, number, number] {
  return [mat[3], mat[7], mat[11]];
}

/** Extract the 3x3 upper-left submatrix (row-major). */
function getRotationScaleSubmatrix(mat: number[]): number[][] {
  return [
    [mat[0], mat[1], mat[2]],
    [mat[4], mat[5], mat[6]],
    [mat[8], mat[9], mat[10]],
  ];
}

/** Compute the scale from the 3x3 submatrix (norm of each row). */
function getScale(sub: number[][]): [number, number, number] {
  return sub.map((row) => Math.sqrt(row[0] ** 2 + row[1] ** 2 + row[2] ** 2)) as [number, number, number];
}

/** Normalize the 3x3 submatrix by dividing each row by its norm → rotation matrix. */
function getRotation(sub: number[][], scale: [number, number, number]): number[][] {
  return sub.map((row, i) => row.map((v) => (scale[i] > 1e-12 ? v / scale[i] : 0)));
}

// ---------------------------------------------------------------------------
// Position conversion
// ---------------------------------------------------------------------------

/**
 * Convert a DAE float position to a piper-draw grid position.
 * Since piper-draw positions = DAE positions (both use scale factor 3),
 * we just round to the nearest integer.
 */
function daeToGridPos(x: number, y: number, z: number): Position3D {
  return {
    x: Math.round(x),
    y: Math.round(y),
    z: Math.round(z),
  };
}

// ---------------------------------------------------------------------------
// Main import
// ---------------------------------------------------------------------------

/**
 * Parse a tqec-compatible Collada DAE XML string into a piper-draw block map.
 * `onSummary` (optional) receives the skip/repair/canonicalise tallies so
 * interactive callers can surface them; silent callers (templates) omit it.
 */
export function parseDaeToBlocks(
  xmlString: string,
  onSummary?: (summary: DaeImportSummary) => void,
): Map<string, Block> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, "application/xml");

  // Check for parse errors
  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error(`DAE parse error: ${parseError.textContent}`);
  }

  // Find visual_scene
  const scenes = findAllByLocalName(doc.documentElement, "visual_scene");
  if (scenes.length === 0) throw new Error("No <visual_scene> found in DAE file.");
  const scene = scenes[0];

  // Find SketchUp node
  const sceneChildren = childrenByLocalName(scene, "node");
  const sketchUpNode = sceneChildren.find((n) => n.getAttribute("name") === "SketchUp");
  if (!sketchUpNode) {
    throw new Error("No 'SketchUp' node found in <visual_scene>. This is required by tqec.");
  }

  // Build library node index: id → element
  const libraryNodesSection = findAllByLocalName(doc.documentElement, "library_nodes");
  const libraryNodeIndex = new Map<string, Element>();
  for (const section of libraryNodesSection) {
    for (const node of childrenByLocalName(section, "node")) {
      const id = node.getAttribute("id");
      if (id) libraryNodeIndex.set(id, node);
    }
  }

  const blocks = new Map<string, Block>();
  // kind name → count of scene nodes skipped for that kind (unknown type or
  // unsupported rotation). Surfaced in the post-import summary toast.
  const skipped = new Map<string, number>();

  // Extract all blocks
  for (const instanceNode of childrenByLocalName(sketchUpNode, "node")) {
    const matrixEl = firstChildByLocalName(instanceNode, "matrix");
    const instNodeRef = firstChildByLocalName(instanceNode, "instance_node");
    if (!matrixEl || !instNodeRef) continue;

    const url = instNodeRef.getAttribute("url");
    if (!url) continue;
    const libNodeId = url.startsWith("#") ? url.slice(1) : url;
    const libNode = libraryNodeIndex.get(libNodeId);
    if (!libNode) continue;

    let kindName = (libNode.getAttribute("name") ?? "").toUpperCase();

    // Skip correlation surface nodes and ports
    if (kindName.endsWith("_CORRELATION") || kindName === "PORT") continue;

    // Validate it's a known block type before rotation
    // (after rotation it should become a valid type)

    const mat = parseMatrix4x4(matrixEl.textContent ?? "");
    const [tx, ty, tz] = getTranslation(mat);
    const sub = getRotationScaleSubmatrix(mat);
    const scale = getScale(sub);
    const rot = getRotation(sub, scale);

    // Handle rotation
    if (!isIdentityRotation(rot)) {
      try {
        kindName = rotateBlockKind(kindName, rot);
      } catch {
        console.warn(`Skipping block with unsupported rotation: ${kindName}`);
        skipped.set(kindName, (skipped.get(kindName) ?? 0) + 1);
        continue;
      }
    }

    // Handle Hadamard direction adjustment for pipes
    const isPipe = kindName.includes("O");
    if (isPipe && kindName.endsWith("H")) {
      const axesDirs = getAxesDirections(rot);
      const dirIdx = pipeDirectionIndex(kindName);
      const dirLabel = ["X", "Y", "Z"][dirIdx];
      if (axesDirs[dirLabel] === -1) {
        kindName = adjustHadamardDirection(kindName);
      }
    }

    // Validate block type
    if (!ALL_BLOCK_TYPES.has(kindName)) {
      console.warn(`Unknown block type "${kindName}", skipping.`);
      skipped.set(kindName, (skipped.get(kindName) ?? 0) + 1);
      continue;
    }

    const blockType = kindName as BlockType;

    // Convert position
    // For pipes with non-default pipe_length, adjust position
    // The DAE position needs to be scaled back if pipe_length != 2.0
    let fx = tx, fy = ty, fz = tz;

    if (isPipe) {
      // Apply rotation-based translation adjustment
      // tqec's rotate_on_import shifts translation by rotation_matrix * scale
      if (!isIdentityRotation(rot)) {
        const scaleMat = scale;
        // translation += rotation_matrix . scale_vector
        for (let i = 0; i < 3; i++) {
          const shift = rot[i][0] * scaleMat[0] + rot[i][1] * scaleMat[1] + rot[i][2] * scaleMat[2];
          if (i === 0) fx = tx + shift;
          else if (i === 1) fy = ty + shift;
          else fz = tz + shift;
        }
      }
    } else if (!isIdentityRotation(rot)) {
      // For cubes, also apply rotation translation adjustment (scale is [1,1,1])
      for (let i = 0; i < 3; i++) {
        const shift = rot[i][0] * scale[0] + rot[i][1] * scale[1] + rot[i][2] * scale[2];
        if (i === 0) fx = tx + shift;
        else if (i === 1) fy = ty + shift;
        else fz = tz + shift;
      }
    }

    // Handle Y half-cube Z offset
    if (blockType === "Y") {
      // tqec's _offset_y_cube_position: if z is close to floor(z) + 0.5, subtract 0.5
      const fractZ = fz - Math.floor(fz);
      if (Math.abs(fractZ - 0.5) < 0.01) {
        fz -= 0.5;
      }
    }

    const pos = daeToGridPos(fx, fy, fz);
    const key = posKey(pos);
    blocks.set(key, { pos, type: blockType });
  }

  const { canonicalised, repaired } = canonicaliseImportedCubes(blocks);
  onSummary?.({ skipped, repaired, canonicalised });

  return blocks;
}

/** What the importer silently changed or dropped, for user-facing summaries. */
export type DaeImportSummary = {
  /** kind name → count of scene nodes skipped for that kind. */
  skipped: Map<string, number>;
  repaired: number;
  canonicalised: number;
};

/**
 * One-line user-facing summary of a parse, or null when nothing noteworthy
 * happened. Emitted as a toast only on the interactive import path
 * (`triggerDaeImport`) — bundled template loads parse the same way but must
 * stay silent (console notes already cover auditability there).
 */
export function daeImportSummaryMessage(summary: DaeImportSummary): string | null {
  const { skipped, repaired, canonicalised } = summary;
  const notes: string[] = [];
  if (skipped.size > 0) {
    const total = [...skipped.values()].reduce((a, b) => a + b, 0);
    const kinds = [...skipped.keys()].join(", ");
    notes.push(`${total} unsupported node${total === 1 ? "" : "s"} skipped (${kinds})`);
  }
  if (repaired > 0) {
    notes.push(`${repaired} cube type${repaired === 1 ? "" : "s"} repaired to match adjacent pipes`);
  }
  if (canonicalised > 0) {
    notes.push(`${canonicalised} ambiguous cube type${canonicalised === 1 ? "" : "s"} canonicalised`);
  }
  if (notes.length === 0) return null;
  return `DAE import: ${notes.join("; ")} — see console for details`;
}

/**
 * After import, normalise each cube whose type is ambiguous given its adjacent
 * pipes (e.g. a cube sandwiched between two Z-pipes could be XZZ or XZX — both
 * are distinct TQEC kinds but indistinguishable in piper-draw's visuals).
 * Piper-draw collapses this ambiguity by always picking the first valid type in
 * CUBE_TYPES order. See CLAUDE.md "Canonicalisation assumption".
 *
 * Exported and reused by bgraph import so DAE and bgraph paths share one rule.
 * Also REPAIRS cubes whose declared type conflicts with their attached pipes
 * (some exporters — e.g. ftdp — use a different junction-cube convention).
 * Left as-is, such cubes fail piper-draw's color-rule check as imported, which
 * vetoes every subsequent whole-scene rotation/flip/move. Repaired cubes take
 * the pipe-determined type, or the canonical-first valid option when the pipes
 * leave several. Returns counts so callers can surface a summary to the user.
 */
export function canonicaliseImportedCubes(
  blocks: Map<string, Block>,
): { canonicalised: number; repaired: number } {
  let canonicalised = 0;
  let repaired = 0;
  for (const [key, block] of blocks) {
    if (isPipeType(block.type) || block.type === "Y") continue;
    // An isolated cube (no adjacent pipes) has all 6 types valid; the user's
    // declared type is always preserved.
    const attached = countAttachedPipes(block.pos, blocks);
    if (attached === 0) continue;
    const result = determineCubeOptions(block.pos, blocks);
    if (result.determined) {
      if (result.type !== block.type) {
        console.log(`[dae import] repairing cube at ${key}: ${block.type} → ${result.type} (type is determined by its pipes)`);
        blocks.set(key, { ...block, type: result.type });
        repaired++;
      }
      continue;
    }
    // options.length === 0 means the pipes themselves conflict — no cube type
    // can satisfy them, so there is nothing sane to repair to. Leave the block
    // for Verify to flag.
    if (result.options.length === 0) continue;
    const declaredValid = result.options.includes(block.type as CubeType);
    // A VALID declared type is only canonicalised at 2+ pipe junctions (see
    // CLAUDE.md); a single-pipe cube keeps its valid declared type. Conflicting
    // declared types are repaired regardless of pipe count — even one attached
    // pipe makes the conflict fail every color-rule check as imported.
    if (declaredValid && (attached < 2 || result.options.length < 2)) continue;
    for (const ct of CUBE_TYPES) {
      if (result.options.includes(ct)) {
        if (ct !== block.type) {
          if (declaredValid) {
            console.log(`[dae import] canonicalising cube at ${key}: ${block.type} → ${ct}`);
            canonicalised++;
          } else {
            console.log(`[dae import] repairing cube at ${key}: ${block.type} → ${ct} (declared type conflicts with its pipes)`);
            repaired++;
          }
          blocks.set(key, { ...block, type: ct });
        }
        break;
      }
    }
  }
  return { canonicalised, repaired };
}

/**
 * Open a file picker and import a .dae file into the block store.
 */
export function triggerDaeImport(onLoad: (blocks: Map<string, Block>) => void): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".dae";
  input.style.display = "none";
  const cleanup = () => {
    if (input.parentNode) input.parentNode.removeChild(input);
  };
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file) { cleanup(); return; }
    const reader = new FileReader();
    reader.onload = () => {
      cleanup();
      try {
        const blocks = parseDaeToBlocks(reader.result as string, (summary) => {
          const msg = daeImportSummaryMessage(summary);
          if (msg) toastBus.info.emit(msg);
        });
        onLoad(blocks);
      } catch (err) {
        console.error("Failed to import DAE file:", err);
        alert(`Failed to import DAE file: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    reader.readAsText(file);
  });
  // Remove on cancel (dialog closed without selecting a file)
  input.addEventListener("cancel", cleanup);
  document.body.appendChild(input);
  input.click();
}
