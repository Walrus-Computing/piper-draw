import { describe, expect, it } from "vitest";
import { evalCoordExpr } from "./parseCoordExpr";

describe("evalCoordExpr", () => {
  it("accepts plain integers", () => {
    expect(evalCoordExpr("5")).toBe(5);
    expect(evalCoordExpr("-3")).toBe(-3);
    expect(evalCoordExpr("  7  ")).toBe(7);
    expect(evalCoordExpr("0")).toBe(0);
  });

  it("evaluates basic arithmetic", () => {
    expect(evalCoordExpr("3+2")).toBe(5);
    expect(evalCoordExpr("4*5-1")).toBe(19);
    expect(evalCoordExpr("(2+3)*2")).toBe(10);
    expect(evalCoordExpr("10/2")).toBe(5);
    expect(evalCoordExpr("10 - 2 - 3")).toBe(5);
  });

  it("handles unary minus and parentheses", () => {
    expect(evalCoordExpr("-(2+3)")).toBe(-5);
    expect(evalCoordExpr("2*-3")).toBe(-6);
    expect(evalCoordExpr("--4")).toBe(4);
    expect(evalCoordExpr("+5")).toBe(5);
  });

  it("rounds non-integer division results", () => {
    expect(evalCoordExpr("5/2")).toBe(3);
    expect(evalCoordExpr("7/2")).toBe(4);
    expect(evalCoordExpr("-5/2")).toBe(-2);
    expect(evalCoordExpr("10/3")).toBe(3);
    expect(evalCoordExpr("10/4")).toBe(3);
  });

  it("does not pre-round intermediate floats", () => {
    expect(evalCoordExpr("1+5/2+5/2")).toBe(6);
  });

  it("rejects division by zero", () => {
    expect(evalCoordExpr("1/0")).toBeNull();
    expect(evalCoordExpr("5/(2-2)")).toBeNull();
  });

  it("rejects malformed input", () => {
    expect(evalCoordExpr("")).toBeNull();
    expect(evalCoordExpr("   ")).toBeNull();
    expect(evalCoordExpr("3+")).toBeNull();
    expect(evalCoordExpr("abc")).toBeNull();
    expect(evalCoordExpr("(1+2")).toBeNull();
    expect(evalCoordExpr("1++2")).toBe(3);
    expect(evalCoordExpr("1 2")).toBeNull();
    expect(evalCoordExpr("*5")).toBeNull();
  });
});
