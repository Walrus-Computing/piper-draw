import { describe, expect, it } from "vitest";
import { isInSpanGF2, pauliToSymplectic } from "./stabilizerSpan";

const vec = (s: string) => pauliToSymplectic(s);

describe("pauliToSymplectic", () => {
  it("encodes single-qubit Paulis", () => {
    expect(vec("I")).toEqual([0, 0]);
    expect(vec("X")).toEqual([1, 0]);
    expect(vec("Z")).toEqual([0, 1]);
    expect(vec("Y")).toEqual([1, 1]);
  });

  it("encodes multi-qubit strings column-major (X-bits, then Z-bits)", () => {
    // XZI → X on qubit 0, Z on qubit 1, I on qubit 2
    // X-bits: [1,0,0]; Z-bits: [0,1,0]
    expect(vec("XZI")).toEqual([1, 0, 0, 0, 1, 0]);
  });
});

describe("isInSpanGF2", () => {
  it("I is always in any span", () => {
    expect(isInSpanGF2([vec("X")], vec("I"))).toBe(true);
    expect(isInSpanGF2([], vec("II"))).toBe(true);
  });

  it("recognises a generator as being in its own span", () => {
    expect(isInSpanGF2([vec("X"), vec("Z")], vec("X"))).toBe(true);
    expect(isInSpanGF2([vec("X"), vec("Z")], vec("Z"))).toBe(true);
  });

  it("recognises XOR of generators: X * Z = Y (up to sign)", () => {
    expect(isInSpanGF2([vec("X"), vec("Z")], vec("Y"))).toBe(true);
  });

  it("rejects a Pauli outside the span (single qubit, only X)", () => {
    expect(isInSpanGF2([vec("X")], vec("Z"))).toBe(false);
    expect(isInSpanGF2([vec("X")], vec("Y"))).toBe(false);
  });

  it("handles CNOT-like generators: XI and IX span XI, IX, XX but not ZI", () => {
    const g = [vec("XI"), vec("IX")];
    expect(isInSpanGF2(g, vec("XI"))).toBe(true);
    expect(isInSpanGF2(g, vec("IX"))).toBe(true);
    expect(isInSpanGF2(g, vec("XX"))).toBe(true);
    expect(isInSpanGF2(g, vec("II"))).toBe(true);
    expect(isInSpanGF2(g, vec("ZI"))).toBe(false);
    expect(isInSpanGF2(g, vec("YI"))).toBe(false);
  });

  it("memory-experiment generators XX, ZZ: XY⊗YX is their product", () => {
    const g = [vec("XX"), vec("ZZ")];
    expect(isInSpanGF2(g, vec("XX"))).toBe(true);
    expect(isInSpanGF2(g, vec("ZZ"))).toBe(true);
    // XX * ZZ = (XZ)(XZ) = YY (up to sign)
    expect(isInSpanGF2(g, vec("YY"))).toBe(true);
    expect(isInSpanGF2(g, vec("II"))).toBe(true);
    // Not in the span:
    expect(isInSpanGF2(g, vec("XI"))).toBe(false);
    expect(isInSpanGF2(g, vec("XZ"))).toBe(false);
  });
});
