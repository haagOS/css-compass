// Every CSS Module member usage in a TS/JS file (`styles.x`, `styles?.x`, `styles["x"]`), for
// diagnostics. Same rules as `usageAt`, applied to the whole file: line-local, outside strings
// and comments that start on the same line, and never after a `.` (`props.styles.x`).
import { lineContext, type ModuleImport } from "./ts-scan.ts";

export interface MemberUsage {
  readonly binding: ModuleImport;
  /** JS name used in the code. */
  readonly name: string;
  /** Range of the name (inside the quotes for `styles["x"]`). */
  readonly start: number;
  readonly end: number;
}

const escape = (name: string) => name.replaceAll("$", "\\$");

export function memberUsages(text: string, imports: readonly ModuleImport[]): MemberUsage[] {
  if (imports.length === 0) return [];
  const byName = new Map(imports.map((i) => [i.name, i]));
  const names = [...byName.keys()].map(escape).join("|");
  const pattern = new RegExp(
    `(?<![\\w$.])(${names})[ \\t]*(?:\\??[ \\t]*\\.[ \\t]*([A-Za-z_$][\\w$]*)|\\[[ \\t]*(["'])([^"'\\\\\\n]*)\\3[ \\t]*\\])`,
    "g",
  );
  const usages: MemberUsage[] = [];
  for (const m of text.matchAll(pattern)) {
    const binding = byName.get(m[1] ?? "");
    const name = m[2] ?? m[4];
    if (!binding || !name) continue;
    const lineStart = text.lastIndexOf("\n", m.index - 1) + 1;
    if (lineContext(text.slice(lineStart, m.index), m.index - lineStart) !== "code") continue;
    // The name is the last identifier (member) or sits right before the closing quote (index).
    const end =
      m[2] !== undefined
        ? m.index + m[0].length
        : m.index + m[0].lastIndexOf(m[3] ?? "", m[0].length - 1);
    usages.push({ binding, name, start: end - name.length, end });
  }
  return usages;
}
