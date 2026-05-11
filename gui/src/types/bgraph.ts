// ---------------------------------------------------------------------------
// TypeScript shapes for the /api/bgraph_export and /api/bgraph_import endpoint
// contracts. These mirror the Pydantic models in bgraph_endpoints.py.
//
// Drift between this file and the backend is caught by the
// bgraphRoundTrip.test.ts test suite (which exercises the real endpoints via
// fetch against a running dev server in CI).
// ---------------------------------------------------------------------------

import type { Block, BlockType, Position3D } from "./index";

/** Block input shape sent to bgraph endpoints (matches BlockInputLocal). */
export interface BgraphBlockInput {
  pos: [number, number, number];
  type: string;
}

/** Port-label entry sent to bgraph_export (matches PortLabelInputLocal). */
export interface BgraphPortLabelInput {
  pos: [number, number, number];
  label: string;
  rank?: number | null;
}

/** Request body for POST /api/bgraph_export. */
export interface BgraphExportRequest {
  blocks: BgraphBlockInput[];
  port_labels?: BgraphPortLabelInput[];
  scene_name?: string | null;
}

/** Successful response from /api/bgraph_export. */
export interface BgraphExportResponse {
  bgraph: string;
  warnings?: string[];
}

/** Request body for POST /api/bgraph_import. */
export interface BgraphImportRequest {
  bgraph: string;
  mode?: "load" | "insert";
}

/** Block output shape (matches BlockOutput Pydantic model). */
export interface BgraphBlockOutput {
  pos: [number, number, number];
  type: string;
}

/** Port-label output shape (matches PortLabelOut Pydantic model). */
export interface BgraphPortLabelOutput {
  pos: [number, number, number];
  label: string;
}

/** Successful response from /api/bgraph_import. */
export interface BgraphImportResponse {
  blocks: BgraphBlockOutput[];
  port_labels: BgraphPortLabelOutput[];
  mode: "load" | "insert";
  warnings?: string[];
}

/** Stable error codes returned by both endpoints in FastAPI HTTPException.detail.code. */
export type BgraphErrorCode =
  | "bgraph_empty"
  | "bgraph_parse_error"
  | "bgraph_invalid_graph"
  | "bgraph_dup_port_label"
  | "bgraph_missing_port_label"
  | "bgraph_too_large";

/** Structured error body emitted by either endpoint on a 4xx response. */
export interface BgraphErrorDetail {
  code: BgraphErrorCode | string;
  message: string;
}

/** Custom Error subclass thrown by bgraphApi.* when a request fails (4xx or network). */
export class BgraphApiError extends Error {
  readonly status: number;
  readonly code: BgraphErrorCode | string | null;

  constructor(message: string, status: number, code: BgraphErrorCode | string | null) {
    super(message);
    this.name = "BgraphApiError";
    this.status = status;
    this.code = code;
  }
}

/** Convert a piper-draw Block back to the BgraphBlockOutput-style shape used
 *  by bgraphApi.ts (positions as [x, y, z] tuples, not Position3D objects). */
export function blockToBgraphInput(b: Block): BgraphBlockInput {
  return { pos: [b.pos.x, b.pos.y, b.pos.z], type: b.type };
}

/** Convert a BgraphBlockOutput from the import endpoint into a piper-draw Block.
 *  The caller decides whether to apply canonicalCubeForPort post-conversion
 *  (yes for the bgraph Load path; the daeImport canonicaliseImportedCubes
 *  helper is reused). */
export function bgraphOutputToBlock(out: BgraphBlockOutput): Block {
  return {
    pos: { x: out.pos[0], y: out.pos[1], z: out.pos[2] },
    type: out.type as BlockType,
  };
}

/** Build a Position3D from a 3-tuple. */
export function tupleToPos(t: [number, number, number]): Position3D {
  return { x: t[0], y: t[1], z: t[2] };
}
