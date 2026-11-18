import type { CssRule } from "./scan.ts";

/** The rule as written (selector + block), dedented and cut to `maxLines`. */
export function ruleSnippet(text: string, rule: CssRule, maxLines = 20): string {
  const lineStart = text.lastIndexOf("\n", rule.selectorStart - 1) + 1;
  const indent = /^[ \t]*/.exec(text.slice(lineStart, rule.selectorStart))?.[0] ?? "";
  const lines = text
    .slice(rule.selectorStart, rule.blockEnd)
    .split(/\r\n|\r|\n/)
    .map((line, i) => (i > 0 && line.startsWith(indent) ? line.slice(indent.length) : line));
  if (lines.length <= maxLines) return lines.join("\n");
  return [...lines.slice(0, maxLines - 1), "  /* … */", lines.at(-1) ?? "}"].join("\n");
}

/** The first `max` declarations of a rule's own block (nested rules skipped). */
export function declarations(text: string, rule: CssRule, max = 5): string[] {
  const closed = text.charCodeAt(rule.blockEnd - 1) === 125; // unclosed blocks run to the end
  const body = text.slice(rule.blockStart + 1, closed ? rule.blockEnd - 1 : rule.blockEnd);
  const out: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let i = 0; i <= body.length && out.length < max; i++) {
    const c = body[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "(" || c === "{") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (c === "}") {
      depth = Math.max(0, depth - 1);
      if (depth === 0) start = i + 1; // end of a nested rule
    } else if ((c === ";" || c === undefined) && depth === 0) {
      const declaration = body
        .slice(start, i)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .trim();
      if (declaration.includes(":") && !declaration.includes("{")) out.push(declaration);
      start = i + 1;
    }
  }
  return out;
}
