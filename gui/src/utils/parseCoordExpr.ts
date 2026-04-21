// Tiny arithmetic evaluator for coordinate input fields (Keyboard Build mode).
// Accepts number literals, `+ - * /`, unary `-`, and parentheses. Returns the
// final value rounded to an integer via Math.round, or `null` if the input is
// empty, malformed, divides by zero, or produces a non-finite result.

export function evalCoordExpr(src: string): number | null {
  const s = src.trim();
  if (s === "") return null;

  let i = 0;

  const skipWs = () => {
    while (i < s.length && (s[i] === " " || s[i] === "\t")) i++;
  };

  const parseNumber = (): number | null => {
    skipWs();
    const start = i;
    while (i < s.length && /[0-9]/.test(s[i])) i++;
    if (i < s.length && s[i] === ".") {
      i++;
      while (i < s.length && /[0-9]/.test(s[i])) i++;
    }
    if (i === start) return null;
    const n = Number(s.slice(start, i));
    return Number.isFinite(n) ? n : null;
  };

  const parseFactor = (): number | null => {
    skipWs();
    if (i >= s.length) return null;
    if (s[i] === "-") {
      i++;
      const v = parseFactor();
      return v === null ? null : -v;
    }
    if (s[i] === "+") {
      i++;
      return parseFactor();
    }
    if (s[i] === "(") {
      i++;
      const v = parseExpr();
      skipWs();
      if (v === null || i >= s.length || s[i] !== ")") return null;
      i++;
      return v;
    }
    return parseNumber();
  };

  const parseTerm = (): number | null => {
    let v = parseFactor();
    if (v === null) return null;
    while (true) {
      skipWs();
      const op = s[i];
      if (op !== "*" && op !== "/") break;
      i++;
      const rhs = parseFactor();
      if (rhs === null) return null;
      if (op === "/") {
        if (rhs === 0) return null;
        v = v / rhs;
      } else {
        v = v * rhs;
      }
    }
    return v;
  };

  const parseExpr = (): number | null => {
    let v = parseTerm();
    if (v === null) return null;
    while (true) {
      skipWs();
      const op = s[i];
      if (op !== "+" && op !== "-") break;
      i++;
      const rhs = parseTerm();
      if (rhs === null) return null;
      v = op === "+" ? v + rhs : v - rhs;
    }
    return v;
  };

  const result = parseExpr();
  skipWs();
  if (result === null || i !== s.length) return null;
  if (!Number.isFinite(result)) return null;
  return Math.round(result);
}
