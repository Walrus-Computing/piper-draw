/**
 * Strict hand-rolled validator for equiseta `FTQCGraph.to_json()` output.
 *
 * Result-style API: `parseFtqcGraph(value)` returns either
 * `{ ok: true, value }` with a typed result, or `{ ok: false, path, expected, got }`
 * with a structured error path that the panel can render inline.
 *
 * The validator is **strict**:
 *   - rejects unknown direction keys on `faces` (e.g. `up`, `front`);
 *   - rejects unknown `FaceColor` enum values (e.g. `green`, `orange`);
 *   - rejects unknown ridge keys.
 *
 * Strict mode surfaces equiseta-side schema drift loudly. This is a viewer,
 * not a forgiving renderer. Source-of-truth schema lives in equiseta PR #29
 * (`equiseta/graphical_ir.py`).
 *
 * **Canonicalization (runtime, pre-strict):** upstream equiseta added a top-level
 * `version` field and switched face direction keys to UPPERCASE somewhere
 * between PR #29 and the `two-qubit-json-examples` branch. We canonicalize at
 * parse entry (`canonicalizeEquisetaJson`) — drop `version`, lowercase the
 * face keys — so strict validation still runs on a known shape and arbitrary
 * fresh upstream JSON (drag-drop / file picker) loads without complaint.
 */

export const FACE_DIRECTIONS = ["top", "bottom", "north", "south", "east", "west"] as const;
export type FaceDirection = (typeof FACE_DIRECTIONS)[number];

export const FACE_COLORS = ["red", "blue", "open", "hadamard", "port", "null"] as const;
export type FaceColor = (typeof FACE_COLORS)[number];

export const RIDGE_IDS = [
  "I_BOT_SOUTH",
  "I_BOT_NORTH",
  "I_TOP_SOUTH",
  "I_TOP_NORTH",
  "J_BOT_WEST",
  "J_BOT_EAST",
  "J_TOP_WEST",
  "J_TOP_EAST",
  "K_SOUTH_WEST",
  "K_SOUTH_EAST",
  "K_NORTH_WEST",
  "K_NORTH_EAST",
] as const;
export type RidgeId = (typeof RIDGE_IDS)[number];

export type Coordinate = readonly [number, number, number];

export interface FtqcNode {
  readonly coordinate: Coordinate;
  readonly faces: Readonly<Record<FaceDirection, FaceColor>>;
  readonly ridges: Readonly<Record<RidgeId, boolean | null>>;
}

export type FtqcEdge = readonly [Coordinate, Coordinate];

export interface FtqcGraph {
  readonly nodes: readonly FtqcNode[];
  readonly edges: readonly FtqcEdge[];
}

export type ParseResult =
  | { ok: true; value: FtqcGraph }
  | { ok: false; path: string; expected: string; got: string };

/** Discriminated failure shape used by internal helpers — strictly the error
 * branch of `ParseResult`, no `ok: true` variant. Lets TypeScript narrow
 * helper return types after `isFail()` checks. */
type Failed = { ok: false; path: string; expected: string; got: string };

const FACE_DIR_SET = new Set<string>(FACE_DIRECTIONS);
const FACE_COLOR_SET = new Set<string>(FACE_COLORS);
const RIDGE_ID_SET = new Set<string>(RIDGE_IDS);

function fail(path: string, expected: string, got: unknown): Failed {
  return { ok: false, path, expected, got: describe(got) };
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `array(length ${value.length})`;
  if (typeof value === "object") return "object";
  if (typeof value === "string") return `string(${JSON.stringify(value)})`;
  if (typeof value === "number") return Number.isInteger(value) ? `integer(${value})` : `number(${value})`;
  return typeof value;
}

function parseCoordinate(value: unknown, path: string): Failed | Coordinate {
  if (!Array.isArray(value)) return fail(path, "array of 3 integers", value);
  if (value.length !== 3) return fail(path, "array of length 3", value);
  for (let i = 0; i < 3; i++) {
    const v = value[i];
    if (typeof v !== "number" || !Number.isInteger(v)) {
      return fail(`${path}[${i}]`, "integer", v);
    }
  }
  return [value[0], value[1], value[2]] as Coordinate;
}

function parseFaces(
  value: unknown,
  path: string,
): Failed | Record<FaceDirection, FaceColor> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return fail(path, "object", value);
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length !== FACE_DIRECTIONS.length) {
    return fail(path, `object with exactly ${FACE_DIRECTIONS.length} face keys`, value);
  }
  for (const key of keys) {
    if (!FACE_DIR_SET.has(key)) {
      return fail(`${path}.${key}`, `one of ${FACE_DIRECTIONS.join("|")}`, key);
    }
  }
  const out = {} as Record<FaceDirection, FaceColor>;
  for (const dir of FACE_DIRECTIONS) {
    const colorVal = obj[dir];
    if (typeof colorVal !== "string" || !FACE_COLOR_SET.has(colorVal)) {
      return fail(`${path}.${dir}`, `one of ${FACE_COLORS.join("|")}`, colorVal);
    }
    out[dir] = colorVal as FaceColor;
  }
  return out;
}

function parseRidges(
  value: unknown,
  path: string,
): Failed | Record<RidgeId, boolean | null> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return fail(path, "object", value);
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length !== RIDGE_IDS.length) {
    return fail(path, `object with exactly ${RIDGE_IDS.length} ridge keys`, value);
  }
  for (const key of keys) {
    if (!RIDGE_ID_SET.has(key)) {
      return fail(`${path}.${key}`, "a known LocalRidgeId", key);
    }
  }
  const out = {} as Record<RidgeId, boolean | null>;
  for (const id of RIDGE_IDS) {
    const v = obj[id];
    if (v !== true && v !== false && v !== null) {
      return fail(`${path}.${id}`, "true | false | null", v);
    }
    out[id] = v;
  }
  return out;
}

function parseNode(value: unknown, path: string): Failed | FtqcNode {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return fail(path, "object", value);
  }
  const obj = value as Record<string, unknown>;
  const expectedKeys = ["coordinate", "faces", "ridges"];
  for (const k of expectedKeys) {
    if (!(k in obj)) return fail(`${path}.${k}`, "present", "missing");
  }
  for (const k of Object.keys(obj)) {
    if (!expectedKeys.includes(k)) return fail(`${path}.${k}`, "absent", "extra key");
  }

  const coord = parseCoordinate(obj.coordinate, `${path}.coordinate`);
  if (isFail(coord)) return coord;
  const faces = parseFaces(obj.faces, `${path}.faces`);
  if (isFail(faces)) return faces;
  const ridges = parseRidges(obj.ridges, `${path}.ridges`);
  if (isFail(ridges)) return ridges;

  return { coordinate: coord, faces, ridges };
}

function parseEdge(value: unknown, path: string): Failed | FtqcEdge {
  if (!Array.isArray(value)) return fail(path, "array of 2 coordinates", value);
  if (value.length !== 2) return fail(path, "array of length 2", value);
  const a = parseCoordinate(value[0], `${path}[0]`);
  if (isFail(a)) return a;
  const b = parseCoordinate(value[1], `${path}[1]`);
  if (isFail(b)) return b;
  return [a, b] as FtqcEdge;
}

function isFail<T>(v: Failed | T): v is Failed {
  return (
    typeof v === "object" &&
    v !== null &&
    "ok" in v &&
    (v as { ok?: unknown }).ok === false
  );
}

/**
 * Pre-strict canonicalization: drop the upstream `version` marker and lowercase
 * face direction keys. Leaves every other shape (node-level keys, ridge keys,
 * color values) untouched so the strict validator still catches real drift.
 *
 * Exported for unit testing. Idempotent — running it twice yields the same
 * result.
 */
export function canonicalizeEquisetaJson(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === "version") continue;
    if (k === "nodes" && Array.isArray(v)) {
      out.nodes = v.map((node) => canonicalizeNode(node));
    } else {
      out[k] = v;
    }
  }
  return out;
}

function canonicalizeNode(node: unknown): unknown {
  if (node === null || typeof node !== "object" || Array.isArray(node)) {
    return node;
  }
  const obj = node as Record<string, unknown>;
  const out: Record<string, unknown> = { ...obj };
  if (obj.faces && typeof obj.faces === "object" && !Array.isArray(obj.faces)) {
    const facesIn = obj.faces as Record<string, unknown>;
    const facesOut: Record<string, unknown> = {};
    for (const [fk, fv] of Object.entries(facesIn)) {
      facesOut[fk.toLowerCase()] = fv;
    }
    out.faces = facesOut;
  }
  return out;
}

/**
 * Parse and validate an unknown JSON-like value as an Equiseta FTQCGraph.
 * Returns a Result object; never throws.
 */
export function parseFtqcGraph(value: unknown): ParseResult {
  const canonical = canonicalizeEquisetaJson(value);
  if (canonical === null || typeof canonical !== "object" || Array.isArray(canonical)) {
    return fail("$", "object", canonical);
  }
  const obj = canonical as Record<string, unknown>;
  if (!("nodes" in obj)) return fail("$.nodes", "present", "missing");
  if (!("edges" in obj)) return fail("$.edges", "present", "missing");
  for (const k of Object.keys(obj)) {
    if (k !== "nodes" && k !== "edges") {
      return fail(`$.${k}`, "absent", "extra key");
    }
  }
  if (!Array.isArray(obj.nodes)) return fail("$.nodes", "array", obj.nodes);
  if (!Array.isArray(obj.edges)) return fail("$.edges", "array", obj.edges);

  const nodes: FtqcNode[] = [];
  for (let i = 0; i < obj.nodes.length; i++) {
    const r = parseNode(obj.nodes[i], `$.nodes[${i}]`);
    if (isFail(r)) return r;
    nodes.push(r);
  }
  const edges: FtqcEdge[] = [];
  for (let i = 0; i < obj.edges.length; i++) {
    const r = parseEdge(obj.edges[i], `$.edges[${i}]`);
    if (isFail(r)) return r;
    edges.push(r);
  }
  return { ok: true, value: { nodes, edges } };
}
