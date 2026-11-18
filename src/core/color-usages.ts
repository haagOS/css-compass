import { findVar } from "./resolve.ts";

export interface ColorUsage {
  readonly start: number;
  readonly end: number;
  /** The text to resolve: a `var(…)`, or a colour function with `var()` arguments. */
  readonly expression: string;
}

const CANDIDATE = /(?<![\w-])(?:rgba?|hsla?)\(|(?<![\w-])var\(/gi;

/**
 * Places that may show a colour swatch (R-COL-1): each outermost `var(…)`, and colour functions
 * whose arguments use `var()` (`rgba(var(--x-rgb), .25)`). Literal colours are left to others.
 */
export function colorUsages(text: string): ColorUsage[] {
  if (!/var\(/i.test(text)) return [];
  const out: ColorUsage[] = [];
  CANDIDATE.lastIndex = 0;
  for (let m = CANDIDATE.exec(text); m; m = CANDIDATE.exec(text)) {
    const start = m.index;
    if (m[0].toLowerCase() === "var(") {
      const call = findVar(text, start);
      if (!call || call.start !== start) continue;
      out.push({ start, end: call.end, expression: text.slice(start, call.end) });
      CANDIDATE.lastIndex = call.end;
      continue;
    }
    const end = closingParen(text, start + m[0].length);
    if (end === undefined) continue;
    const expression = text.slice(start, end);
    if (!/var\(/i.test(expression)) continue;
    out.push({ start, end, expression });
    CANDIDATE.lastIndex = end;
  }
  return out;
}

/** End offset (after `)`) of the call whose arguments start at `from`; undefined if unclosed. */
function closingParen(text: string, from: number): number | undefined {
  let depth = 1;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i + 1;
    else if (c === ";" || c === "{" || c === "}" || c === "\n") return undefined;
  }
  return undefined;
}
