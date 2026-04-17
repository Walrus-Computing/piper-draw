import type { Block, BlockType, CubeType, Position3D } from "../types";
import { CUBE_TYPES, PIPE_TYPES, posKey, isPipeType, determineCubeOptions, countAttachedPipes } from "../types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALL_BLOCK_TYPES: ReadonlySet<string> = new Set([
  ...CUBE_TYPES,
  ...PIPE_TYPES,
  "Y",
]);

// Hadamard direction-flip equivalences (same as tqec's adjust_hadamards_direction)
const HDM_EQUIVALENCES: Record<string, string> = {
  ZXOH: "XZOH",
  XOZH: "ZOXH",
  OXZH: "OZXH",
};
const HDM_INVERSE: Record<string, string> = Object.fromEntries(
  Object.entries(HDM_EQUIVALENCES).map(([k, v]) => [v, k]),
);

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

/** Check if a 3x3 matrix is approximately identity. */
function isIdentityRotation(rot: number[][]): boolean {
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const expected = i === j ? 1 : 0;
      if (Math.abs(rot[i][j] - expected) > 1e-6) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Rotation → block kind remapping (port of tqec's rotate_block_kind_by_matrix)
// ---------------------------------------------------------------------------

/**
 * Get axis direction multipliers from a rotation matrix.
 * For each row, return +1 or -1 based on the sum of elements.
 */
function getAxesDirections(rot: number[][]): Record<string, number> {
  const dirs: Record<string, number> = {};
  const labels = ["X", "Y", "Z"];
  for (let i = 0; i < 3; i++) {
    const sum = rot[i][0] + rot[i][1] + rot[i][2];
    dirs[labels[i]] = sum < 0 ? -1 : 1;
  }
  return dirs;
}

/**
 * Rotate a block kind name using the rotation matrix.
 * Port of tqec's `rotate_block_kind_by_matrix`.
 */
function rotateBlockKind(kindStr: string, rot: number[][]): string {
  const isY = kindStr === "Y";
  // For Y blocks, use "Y-!" as the base for the rotation check
  const originalName = isY ? "Y-!" : kindStr.slice(0, 3);

  let rotatedName = "";
  for (const row of rot) {
    let entry = "";
    for (let j = 0; j < 3; j++) {
      const count = Math.abs(Math.round(row[j]));
      entry += originalName[j].repeat(count);
    }
    rotatedName += entry;
  }

  const axesDirs = getAxesDirections(rot);

  // Y / cultivation blocks: reject invalid rotations, keep original name
  if (rotatedName.includes("!")) {
    if (!rotatedName.endsWith("!") || axesDirs["Z"] < 0) {
      throw new Error(
        `Invalid rotation for ${kindStr} block: cultivation and Y blocks only allow rotation around Z axis.`,
      );
    }
    return kindStr;
  }

  // Hadamard: append 'H' if original had it
  if (kindStr.endsWith("H")) {
    rotatedName += "H";
  }

  return rotatedName.toUpperCase();
}

/**
 * Adjust Hadamard pipe direction when pointing in negative direction.
 * Port of tqec's `adjust_hadamards_direction`.
 */
function adjustHadamardDirection(kindStr: string): string {
  if (kindStr in HDM_EQUIVALENCES) return HDM_EQUIVALENCES[kindStr];
  if (kindStr in HDM_INVERSE) return HDM_INVERSE[kindStr];
  return kindStr;
}

/**
 * Get the pipe direction axis index from a pipe kind (position of 'O').
 */
function pipeDirectionIndex(kindStr: string): number {
  return kindStr.slice(0, 3).indexOf("O");
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
 */
export function parseDaeToBlocks(xmlString: string): Map<string, Block> {
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

  // Detect pipe_length from pipe scales
  let pipeLength: number | null = null;

  // First pass: detect pipe_length
  for (const instanceNode of childrenByLocalName(sketchUpNode, "node")) {
    const matrixEl = firstChildByLocalName(instanceNode, "matrix");
    const instNodeRef = firstChildByLocalName(instanceNode, "instance_node");
    if (!matrixEl || !instNodeRef) continue;

    const url = instNodeRef.getAttribute("url");
    if (!url) continue;
    const libNodeId = url.startsWith("#") ? url.slice(1) : url;
    const libNode = libraryNodeIndex.get(libNodeId);
    if (!libNode) continue;

    const kindName = (libNode.getAttribute("name") ?? "").toUpperCase();
    if (!kindName.includes("O")) continue; // not a pipe

    const mat = parseMatrix4x4(matrixEl.textContent ?? "");
    const sub = getRotationScaleSubmatrix(mat);
    const scale = getScale(sub);

    // Find the pipe direction and its scale
    const dirIdx = pipeDirectionIndex(kindName);
    if (dirIdx >= 0) {
      const detectedLength = scale[dirIdx] * 2.0;
      if (pipeLength === null) {
        pipeLength = detectedLength;
      }
    }
  }

  if (pipeLength === null) pipeLength = 2.0;

  const blocks = new Map<string, Block>();

  // Second pass: extract all blocks
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

  canonicaliseImportedCubes(blocks);
  return blocks;
}

/**
 * After import, normalise each cube whose type is ambiguous given its adjacent
 * pipes (e.g. a cube sandwiched between two Z-pipes could be XZZ or XZX — both
 * are distinct TQEC kinds but indistinguishable in piper-draw's visuals).
 * Piper-draw collapses this ambiguity by always picking the first valid type in
 * CUBE_TYPES order. See CLAUDE.md "Canonicalisation assumption".
 */
function canonicaliseImportedCubes(blocks: Map<string, Block>): void {
  for (const [key, block] of blocks) {
    if (isPipeType(block.type) || block.type === "Y") continue;
    // Only canonicalise when pipes actually constrain the cube to 2+ options.
    // An isolated cube (no adjacent pipes) has all 6 types valid but the user's
    // declared type should be preserved.
    if (countAttachedPipes(block.pos, blocks) < 2) continue;
    const result = determineCubeOptions(block.pos, blocks);
    if (result.determined) continue;
    if (result.options.length < 2) continue;
    if (!result.options.includes(block.type as CubeType)) continue;
    for (const ct of CUBE_TYPES) {
      if (result.options.includes(ct)) {
        if (ct !== block.type) {
          console.log(`[dae import] canonicalising cube at ${key}: ${block.type} → ${ct}`);
          blocks.set(key, { pos: block.pos, type: ct });
        }
        break;
      }
    }
  }
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
        const blocks = parseDaeToBlocks(reader.result as string);
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
