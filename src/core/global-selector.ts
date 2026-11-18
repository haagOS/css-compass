// `.class` names inside `:global(…)` in CSS (R-CSS-4), line-local.

export interface GlobalSelectorToken {
  readonly name: string;
  readonly start: number;
  readonly end: number;
  /** Typed so far (from `start` to the cursor). */
  readonly prefix: string;
}

/** The class name at `offset` if it sits right after a `.` inside `:global(…)`. */
export function globalSelectorAt(text: string, offset: number): GlobalSelectorToken | undefined {
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  let lineEnd = text.indexOf("\n", offset);
  if (lineEnd < 0) lineEnd = text.length;
  const prefix = text.slice(lineStart, offset);
  const m = /:global\(([^()]*)$/i.exec(prefix);
  if (!m) return undefined;
  const left = /\.([\w-]*)$/.exec(m[1] ?? "");
  if (!left) return undefined;
  const typed = left[1] ?? "";
  const right = /^[\w-]*/.exec(text.slice(offset, lineEnd))?.[0] ?? "";
  const start = offset - typed.length;
  return { name: typed + right, start, end: offset + right.length, prefix: typed };
}
