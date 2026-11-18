// Custom property usages on the current line: `var(--name`, a `--name:` declaration, a string
// that is exactly `--name`, and the completion site inside `var(`. Line-local like the CSS
// Module usages in ts-scan.ts.

export interface PropertyUsage {
  readonly name: string;
  readonly start: number;
  readonly end: number;
  /** `var`: inside `var(…)`; `declaration`: `--name:`; `name`: a string that is `--name`. */
  readonly kind: "var" | "declaration" | "name";
}

export interface PropertySite {
  /** Typed so far, including the dashes (may be empty right after `var(`). */
  readonly prefix: string;
  /** Range to replace: the whole `--…` token around the cursor. */
  readonly start: number;
  readonly end: number;
}

const NAME_LEFT = /[\w-]*$/;
const NAME_RIGHT = /^[\w-]*/;

function line(text: string, offset: number) {
  const start = text.lastIndexOf("\n", offset - 1) + 1;
  let end = text.indexOf("\n", offset);
  if (end < 0) end = text.length;
  return { start, prefix: text.slice(start, offset), suffix: text.slice(offset, end) };
}

/** The whole `--name` token around `offset` and the line text around it. */
function nameAt(text: string, offset: number) {
  const { start: lineStart, prefix, suffix } = line(text, offset);
  const left = NAME_LEFT.exec(prefix)?.[0] ?? "";
  const right = NAME_RIGHT.exec(suffix)?.[0] ?? "";
  const name = left + right;
  if (!name.startsWith("--") || name.length <= 2) return undefined;
  const start = lineStart + prefix.length - left.length;
  const end = start + name.length;
  const lineEnd = lineStart + prefix.length + suffix.length;
  return {
    name,
    start,
    end,
    before: text.slice(lineStart, start),
    after: text.slice(end, lineEnd),
  };
}

/** The custom property usage at `offset`: inside `var(…)` or a `--name:` declaration. */
export function propertyUsageAt(text: string, offset: number): PropertyUsage | undefined {
  const at = nameAt(text, offset);
  if (!at) return undefined;
  const { name, start, end, before, after } = at;
  if (/var\(\s*$/i.test(before)) return { name, start, end, kind: "var" };
  if (/^\s*:/.test(after) && /(^|[{;\s])$/.test(before)) {
    return { name, start, end, kind: "declaration" };
  }
  return undefined;
}

/** A string literal whose whole content is `--name` (R-TS-2); the caller checks it is a string. */
export function bareNameAt(text: string, offset: number): PropertyUsage | undefined {
  const at = nameAt(text, offset);
  if (!at) return undefined;
  const open = at.before.at(-1);
  if ((open !== '"' && open !== "'" && open !== "`") || !at.after.startsWith(open)) {
    return undefined;
  }
  return { name: at.name, start: at.start, end: at.end, kind: "name" };
}

/** Where a custom property name can be completed: right after `var(` or inside its name. */
export function propertySiteAt(text: string, offset: number): PropertySite | undefined {
  const { prefix, suffix } = line(text, offset);
  const m = /var\(\s*(-{0,2}[\w-]*)$/i.exec(prefix);
  if (!m) return undefined;
  const typed = m[1] ?? "";
  if (typed !== "" && !typed.startsWith("-")) return undefined;
  const rest = NAME_RIGHT.exec(suffix)?.[0] ?? "";
  return { prefix: typed, start: offset - typed.length, end: offset + rest.length };
}
