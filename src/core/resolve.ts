import type { CssProperty } from "./scan.ts";
import type { Definition } from "./symbol-index.ts";

export type PropertyDefinition = Definition<CssProperty>;

/**
 * Definitions ordered by how much they count for a use in `scopeParts`: same scope, then
 * `:root`, then any; within those, definitions outside at-rules (`@media` …) first; then the
 * later one, as in the cascade. `defs` must be in index order (file, then position).
 */
export function byPreference(
  defs: readonly PropertyDefinition[],
  scopeParts: readonly string[] = [],
): PropertyDefinition[] {
  const rank = (d: PropertyDefinition) => {
    const parts = d.symbol.scopeParts;
    const scope = parts.some((p) => scopeParts.includes(p)) ? 0 : parts.includes(":root") ? 1 : 2;
    return scope * 2 + (d.symbol.atRules.length === 0 ? 0 : 1);
  };
  return defs
    .map((d, i) => ({ d, i, r: rank(d) }))
    .toSorted((a, b) => a.r - b.r || b.i - a.i)
    .map((x) => x.d);
}

export interface Resolution {
  /** Each value from the raw one to the last; one `var()` level substituted per step. */
  readonly steps: readonly string[];
  /** The last step. */
  readonly value: string;
  /** False if a `var()` is left (undefined without fallback, cycle or depth limit). */
  readonly complete: boolean;
}

export const MAX_STEPS = 10;

/** A piece of a value, with the scope its `var()`s are looked up in. */
interface Segment {
  readonly text: string;
  readonly scope: readonly string[];
}

/**
 * Resolves every `var()` in `value`, one level per step (SPEC §6). A substituted value keeps
 * the scope of the definition it came from, so its own `var()`s are looked up there first.
 */
export function resolveValue(
  value: string,
  lookup: (name: string) => readonly PropertyDefinition[],
  scopeParts: readonly string[] = [],
): Resolution {
  let segments: readonly Segment[] = [{ text: value, scope: scopeParts }];
  const steps = [value];
  const seen = new Set([value]);
  for (let i = 0; i < MAX_STEPS; i++) {
    segments = segments.flatMap((segment) => substitute(segment, lookup));
    const next = segments.map((s) => s.text).join("");
    if (seen.has(next)) break;
    seen.add(next);
    steps.push(next);
  }
  const last = steps.at(-1) ?? value;
  return { steps, value: last, complete: !hasVar(last) };
}

interface VarCall {
  readonly start: number;
  readonly end: number;
  readonly name: string;
  readonly fallback: string | undefined;
}

/** Replaces each outermost `var()` by the counting definition's raw value or its fallback. */
function substitute(
  segment: Segment,
  lookup: (name: string) => readonly PropertyDefinition[],
): Segment[] {
  const { text, scope } = segment;
  const out: Segment[] = [];
  let from = 0;
  for (let call = findVar(text, 0); call; call = findVar(text, call.end)) {
    if (call.start > from) out.push({ text: text.slice(from, call.start), scope });
    const def = byPreference(lookup(call.name), scope)[0];
    if (def) out.push({ text: def.symbol.value, scope: def.symbol.scopeParts });
    else if (call.fallback !== undefined) out.push({ text: call.fallback, scope });
    else out.push({ text: text.slice(call.start, call.end), scope });
    from = call.end;
  }
  if (from < text.length) out.push({ text: text.slice(from), scope });
  return out;
}

/** True if a `var(--` is left outside strings, closed or not. */
function hasVar(value: string): boolean {
  const withoutStrings = value.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, "");
  return /(^|[^\w-])var\(\s*--/i.test(withoutStrings);
}

/** The next `var(--name[, fallback])` at or after `from`, skipping strings. */
export function findVar(value: string, from: number): VarCall | undefined {
  let quote = "";
  for (let i = from; i < value.length; i++) {
    const c = value[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if ((c !== "v" && c !== "V") || /[\w-]/.test(value[i - 1] ?? "")) continue;
    const head = /^var\(\s*(--[\w-]+)\s*/i.exec(value.slice(i, i + 200));
    if (!head) continue;
    const call = closeVar(value, i, i + head[0].length, head[1] ?? "");
    return call; // an unclosed var() ends the search: nothing after it is complete
  }
  return undefined;
}

function closeVar(value: string, start: number, from: number, name: string): VarCall | undefined {
  let depth = 1;
  let quote = "";
  let comma = -1;
  let i = from;
  for (; i < value.length && depth > 0; i++) {
    const c = value[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 1 && comma < 0) comma = i;
  }
  if (depth > 0) return undefined;
  const fallback = comma < 0 ? undefined : value.slice(comma + 1, i - 1).trim();
  return { start, end: i, name, fallback };
}
