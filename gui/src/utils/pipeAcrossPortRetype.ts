import {
  CUBE_TYPES,
  PIPE_TYPES,
  type Block,
  type BlocksLookup,
  type CubeType,
  type PipeType,
  type Position3D,
  computePipeRetypes,
  determineCubeOptions,
  isPipeType,
  pipeEndBasis,
  posKey,
} from "../types";

export interface AcrossPortRetypeInput {
  pipePos: Position3D;
  pipeType: PipeType;
  blocks: BlocksLookup;
  // Mutated in place: helper appends its pipe retypes here so callers running
  // multiple passes (e.g. cube-cycle followed by Step 1.5) accumulate correctly.
  overrides: Map<string, Block | undefined>;
}

export type AcrossPortRetypeResult =
  | {
      ok: true;
      pipeRetypes: Array<{ key: string; oldBlock: Block; newBlock: Block }>;
      extraCubeSeeds: Array<{ key: string; existing: Block }>;
    }
  | { ok: false; reason: string };

interface AttachedPipe {
  axis: 0 | 1 | 2;
  pos: Position3D;
  key: string;
  type: PipeType;
  // pipeOffset == +1 → port is at pipe's HEAD (offset -1 from pipe pos).
  // pipeOffset == -2 → port is at pipe's TAIL (offset +2 from pipe pos).
  pipeOffset: 1 | -2;
}

function makeOverlay(
  base: BlocksLookup,
  overrides: Map<string, Block | undefined>,
): BlocksLookup {
  return {
    get(key: string) {
      return overrides.has(key) ? overrides.get(key) : base.get(key);
    },
  };
}

function farCoordOf(ap: AttachedPipe): Position3D {
  const c: [number, number, number] = [ap.pos.x, ap.pos.y, ap.pos.z];
  c[ap.axis] += ap.pipeOffset === 1 ? 2 : -1;
  return { x: c[0], y: c[1], z: c[2] };
}

interface PortChoice {
  T: CubeType;
  perPipe: Array<{ pipe: AttachedPipe; strict: PipeType[]; wider: PipeType[] }>;
}

function findAttachedAtPort(
  portCoords: [number, number, number],
  pipeKey: string,
  overlay: BlocksLookup,
): AttachedPipe[] {
  const attached: AttachedPipe[] = [];
  for (let axis = 0; axis < 3; axis++) {
    for (const pOffset of [1, -2] as const) {
      const nCoords: [number, number, number] = [portCoords[0], portCoords[1], portCoords[2]];
      nCoords[axis] += pOffset;
      const nPos: Position3D = { x: nCoords[0], y: nCoords[1], z: nCoords[2] };
      const nKey = posKey(nPos);
      if (nKey === pipeKey) continue;
      const nBlock = overlay.get(nKey);
      if (!nBlock || !isPipeType(nBlock.type)) continue;
      if (nBlock.type.replace("H", "").indexOf("O") !== axis) continue;
      attached.push({
        axis: axis as 0 | 1 | 2,
        pos: nPos,
        key: nKey,
        type: nBlock.type as PipeType,
        pipeOffset: pOffset,
      });
    }
  }
  return attached;
}

/**
 * For a fixed cube type T at the port, gather strict and wider candidate pipe
 * retypes for one attached pipe. Strict means the pipe's far cube (if any)
 * accepts the candidate as-is; wider means the far cube must retype too.
 */
function candidatesForPipe(
  ap: AttachedPipe,
  T: CubeType,
  portPos: Position3D,
  portKey: string,
  blocks: BlocksLookup,
  overrides: Map<string, Block | undefined>,
): { strict: PipeType[]; wider: PipeType[] } {
  const portSwapped = ap.pipeOffset === -2; // port at +2 from this pipe = tail
  const strict: PipeType[] = [];
  const wider: PipeType[] = [];

  for (const c of PIPE_TYPES) {
    const cBase = c.replace("H", "");
    if (cBase.indexOf("O") !== ap.axis) continue;
    const cH = c.length > 3;

    let portOk = true;
    for (let a = 0; a < 3; a++) {
      if (a === ap.axis) continue;
      if (pipeEndBasis(cBase, cH, ap.axis, a, portSwapped) !== T[a]) { portOk = false; break; }
    }
    if (!portOk) continue;

    const innerOverrides = new Map(overrides);
    innerOverrides.set(portKey, { pos: portPos, type: T });
    innerOverrides.set(ap.key, { pos: ap.pos, type: c });
    const innerOverlay = makeOverlay(blocks, innerOverrides);
    const farPos = farCoordOf(ap);
    const farKey = posKey(farPos);
    const farBlock = innerOverlay.get(farKey);

    if (!farBlock) {
      const farOpts = determineCubeOptions(farPos, innerOverlay);
      if (farOpts.determined || farOpts.options.length > 0) strict.push(c);
      continue;
    }
    if (isPipeType(farBlock.type) || farBlock.type === "Y") continue;

    const farOpts = determineCubeOptions(farPos, innerOverlay);
    const farCandidates: readonly CubeType[] = farOpts.determined ? [farOpts.type] : farOpts.options;
    if (farCandidates.length === 0) continue;
    if (farCandidates.includes(farBlock.type as CubeType)) strict.push(c);
    else wider.push(c);
  }
  return { strict, wider };
}

/**
 * Pick the canonical first feasible cube type T at a port. Returns null when
 * no T accepts the anchor and has feasible per-pipe candidates.
 */
function pickPortCube(
  attached: AttachedPipe[],
  acceptsAnchor: (T: CubeType) => boolean,
  portPos: Position3D,
  portKey: string,
  blocks: BlocksLookup,
  overrides: Map<string, Block | undefined>,
): PortChoice | null {
  for (const T of CUBE_TYPES) {
    if (!acceptsAnchor(T)) continue;
    const perPipe: Array<{ pipe: AttachedPipe; strict: PipeType[]; wider: PipeType[] }> = [];
    let feasible = true;
    for (const ap of attached) {
      const { strict, wider } = candidatesForPipe(ap, T, portPos, portKey, blocks, overrides);
      if (strict.length === 0 && wider.length === 0) { feasible = false; break; }
      perPipe.push({ pipe: ap, strict, wider });
    }
    if (feasible) return { T, perPipe };
  }
  return null;
}

/**
 * Reconcile pipe types across a shared port endpoint of an "anchor" pipe.
 *
 * Used by three call sites:
 *  1. `validatePipePlacement` — anchor = the new pipe being placed.
 *  2. Keyboard build pipe placement — same shape as #1.
 *  3. Cube-cycle (`cycleSelectedType` / `cycleBlock`) — anchor = a pipe that just
 *     got retyped by `computePipeRetypes`. Cube-side endpoint is naturally
 *     skipped (occupied), so only the far-port endpoint reconciles.
 *
 * Per port endpoint of the anchor (offset ∈ {-1, +2} along its open axis):
 *  - Skip if the slot has a cube/Y (already handled by caller's cube-endpoint path).
 *  - Skip if no other pipes are attached at the port.
 *  - Skip if the port is already promotable in a way the anchor accepts.
 *  - Otherwise enumerate cube types T (CUBE_TYPES order) the anchor accepts,
 *    and for each attached pipe enumerate retypes that:
 *      strict: keep the pipe's far-cube type intact
 *      wider:  require the pipe's far cube to retype too (cascade)
 *  - Pick the first feasible T (strict-only if any pipe has no strict option,
 *    we fall back to wider for that pipe and queue its far cube for cascade).
 *  - Per-pipe retype preference: keep oldType, else preserve H state, else first.
 */
export function resolveAcrossPortPipes(input: AcrossPortRetypeInput): AcrossPortRetypeResult {
  const { pipePos, pipeType, blocks, overrides } = input;
  const pipeKey = posKey(pipePos);
  const baseAnchor = pipeType.replace("H", "");
  const hadamardAnchor = pipeType.length > 3;
  const openAxis = baseAnchor.indexOf("O") as 0 | 1 | 2;
  const coords: [number, number, number] = [pipePos.x, pipePos.y, pipePos.z];

  const pipeRetypes: Array<{ key: string; oldBlock: Block; newBlock: Block }> = [];
  const extraCubeSeeds: Array<{ key: string; existing: Block }> = [];

  for (const offset of [-1, 2] as const) {
    const portCoords: [number, number, number] = [coords[0], coords[1], coords[2]];
    portCoords[openAxis] += offset;
    const portPos: Position3D = { x: portCoords[0], y: portCoords[1], z: portCoords[2] };
    const portKey = posKey(portPos);

    const overlay = makeOverlay(blocks, overrides);
    if (overlay.get(portKey)) continue;

    const attached = findAttachedAtPort(portCoords, pipeKey, overlay);
    if (attached.length === 0) continue;

    const anchorSwappedAtPort = offset === 2;
    const acceptsAnchor = (T: CubeType): boolean => {
      for (let a = 0; a < 3; a++) {
        if (a === openAxis) continue;
        if (pipeEndBasis(baseAnchor, hadamardAnchor, openAxis, a, anchorSwappedAtPort) !== T[a]) return false;
      }
      return true;
    };

    const opts = determineCubeOptions(portPos, overlay);
    const optList: readonly CubeType[] = opts.determined ? [opts.type] : opts.options;
    if (optList.some(acceptsAnchor)) continue;

    const chosen = pickPortCube(attached, acceptsAnchor, portPos, portKey, blocks, overrides);
    if (!chosen) {
      return { ok: false, reason: `No across-port retype resolves the conflict at port ${portKey}` };
    }

    for (const { pipe: ap, strict, wider } of chosen.perPipe) {
      const cands = strict.length > 0 ? strict : wider;
      let newType: PipeType;
      if (cands.includes(ap.type)) newType = ap.type;
      else {
        const oldH = ap.type.length > 3;
        newType = cands.find((c) => (c.length > 3) === oldH) ?? cands[0];
      }
      if (newType !== ap.type) {
        const oldBlock = blocks.get(ap.key);
        if (!oldBlock) continue;
        const newBlock: Block = { ...oldBlock, type: newType };
        pipeRetypes.push({ key: ap.key, oldBlock, newBlock });
        overrides.set(ap.key, newBlock);
      }
      if (!strict.includes(newType)) {
        const farPos = farCoordOf(ap);
        const farKey = posKey(farPos);
        const farBlock = makeOverlay(blocks, overrides).get(farKey);
        if (farBlock && !isPipeType(farBlock.type) && farBlock.type !== "Y") {
          extraCubeSeeds.push({ key: farKey, existing: farBlock });
        }
      }
    }
  }

  return { ok: true, pipeRetypes, extraCubeSeeds };
}

/**
 * Apply far-cube cascade: for each seed cube, pick the canonical first-valid
 * `CubeType` consistent with the (overlay-visible) adjacent pipes, push the
 * cube retype into `replaces`/`overrides`, then flow `computePipeRetypes` to
 * any neighbour pipes the cube retype induces. Returns false on irreconcilable
 * conflict (no canonical type, or `computePipeRetypes` returns null).
 *
 * Shared by `validatePipePlacement`'s Step 2, the keyboard-build path, and the
 * cube-cycle paths so all three exhibit the same cascade semantics.
 */
export function applyCubeSeedCascade(
  seeds: ReadonlyArray<{ key: string; existing: Block }>,
  blocks: BlocksLookup,
  overrides: Map<string, Block | undefined>,
  replaces: Array<{ key: string; oldBlock: Block; newBlock: Block }>,
  excludePipeKey: string | null = null,
  seenPipeKeys: Set<string> = new Set<string>(),
): { ok: true } | { ok: false; reason: string } {
  for (const seed of seeds) {
    const overlay = makeOverlay(blocks, overrides);
    const opts = determineCubeOptions(seed.existing.pos, overlay);
    const candidates: readonly CubeType[] = opts.determined ? [opts.type] : opts.options;
    if (candidates.length === 0) {
      return { ok: false, reason: `Cascade: no cube type satisfies attached pipes at ${seed.key}` };
    }
    let chosenT: CubeType | null = null;
    for (const ct of CUBE_TYPES) {
      if (candidates.includes(ct)) {
        chosenT = ct;
        break;
      }
    }
    if (!chosenT) {
      return { ok: false, reason: `Cascade: no canonical cube type at ${seed.key}` };
    }

    if (chosenT !== seed.existing.type) {
      const newBlock: Block = { ...seed.existing, type: chosenT };
      replaces.push({ key: seed.key, oldBlock: seed.existing, newBlock });
      overrides.set(seed.key, newBlock);
    }

    const overlayAfter = makeOverlay(blocks, overrides);
    const pipeUpdates = computePipeRetypes(overlayAfter, seed.existing.pos, chosenT);
    if (pipeUpdates === null) {
      return { ok: false, reason: `Cascade: adjacent pipe at ${seed.key} cannot be retyped` };
    }
    for (const upd of pipeUpdates) {
      if (upd.key === excludePipeKey) continue;
      if (seenPipeKeys.has(upd.key)) continue;
      seenPipeKeys.add(upd.key);
      const oldPipe = blocks.get(upd.key);
      const overrideEntry = overrides.get(upd.key);
      const currentPipe = overrideEntry ?? oldPipe;
      if (!currentPipe) continue;
      const basisOld = oldPipe ?? currentPipe;
      const newPipe: Block = { ...basisOld, type: upd.newType };
      replaces.push({ key: upd.key, oldBlock: basisOld, newBlock: newPipe });
      overrides.set(upd.key, newPipe);
    }
  }
  return { ok: true };
}
