// ---------------------------------------------------------------------------
// Thin fetch wrapper around the /api/bgraph_export and /api/bgraph_import
// FastAPI endpoints. Frontend treats Position3D as opaque (no coord swap on
// this side — see eng-review E4). Errors normalize to BgraphApiError with the
// backend-supplied error code attached.
// ---------------------------------------------------------------------------

import type { Block } from "../types";
import type { BgraphErrorDetail, BgraphExportRequest, BgraphExportResponse, BgraphImportRequest, BgraphImportResponse, BgraphPortLabelInput } from "../types/bgraph";
import { BgraphApiError, blockToBgraphInput } from "../types/bgraph";

async function parseError(res: Response): Promise<BgraphApiError> {
  let detail: BgraphErrorDetail | null = null;
  try {
    const body = await res.json();
    if (body && typeof body === "object" && body.detail && typeof body.detail === "object") {
      detail = body.detail as BgraphErrorDetail;
    } else if (typeof body?.detail === "string") {
      detail = { code: "unknown", message: body.detail };
    }
  } catch {
    // Response wasn't JSON — fall through.
  }
  const message = detail?.message ?? `Server error: ${res.status}`;
  return new BgraphApiError(message, res.status, detail?.code ?? null);
}

export interface ExportArgs {
  blocks: Map<string, Block>;
  portLabels: BgraphPortLabelInput[];
  sceneName?: string;
}

/** POST /api/bgraph_export. Returns the bgraph string on success, throws
 *  BgraphApiError on any backend rejection (empty scene, dup labels, missing
 *  labels, network error). Caller is responsible for downloading or copying
 *  the returned string. */
export async function exportBgraph(args: ExportArgs): Promise<BgraphExportResponse> {
  const payload: BgraphExportRequest = {
    blocks: Array.from(args.blocks.values()).map(blockToBgraphInput),
    port_labels: args.portLabels,
    scene_name: args.sceneName ?? null,
  };

  let res: Response;
  try {
    res = await fetch("/api/bgraph_export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    throw new BgraphApiError(
      `Network error: ${e instanceof Error ? e.message : String(e)}`,
      0,
      null,
    );
  }
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as BgraphExportResponse;
}

export interface ImportArgs {
  bgraph: string;
  mode?: "load" | "insert";
}

/** POST /api/bgraph_import. Returns the parsed blocks + port labels on success,
 *  throws BgraphApiError on any backend rejection (parse error, empty, dup
 *  labels, size cap, network). Caller is responsible for:
 *
 *  1. Converting the BgraphBlockOutput[] back to piper-draw Block[] via
 *     `bgraphOutputToBlock` (re-exported from `../types/bgraph`).
 *  2. Applying the sandwich-cube canonicalization rule via the same helper
 *     daeImport uses (`canonicaliseImportedCubes`).
 *  3. Counting normalized cubes and surfacing the canonicalization toast. */
export async function importBgraph(args: ImportArgs): Promise<BgraphImportResponse> {
  const payload: BgraphImportRequest = {
    bgraph: args.bgraph,
    mode: args.mode ?? "load",
  };

  let res: Response;
  try {
    res = await fetch("/api/bgraph_import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    throw new BgraphApiError(
      `Network error: ${e instanceof Error ? e.message : String(e)}`,
      0,
      null,
    );
  }
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as BgraphImportResponse;
}

/** Convenience: trigger a browser download of a bgraph string. */
export function downloadBgraph(bgraph: string, filename: string): void {
  const blob = new Blob([bgraph], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".bgraph") ? filename : `${filename}.bgraph`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
