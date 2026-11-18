import * as path from "node:path";
import * as vscode from "vscode";
import type { CssFile } from "../core/css-store.ts";
import { ruleSnippet } from "../core/preview.ts";
import type { CssClass } from "../core/scan.ts";

/** `[name:12](file:///…#L12)`; `name` defaults to the file name. */
export function fileLink(file: CssFile, offset: number, name = path.basename(file.file)): string {
  const line = file.lines.positionAt(offset).line + 1;
  const uri = vscode.Uri.file(file.file).with({ fragment: `L${line}` });
  return `[${name}:${line}](${uri.toString()})`;
}

/**
 * Appends each rule declaring one of `classes` once: its at-rule chain as comments, the rule as
 * written, and a link to it.
 */
export function appendClassRules(
  md: vscode.MarkdownString,
  file: CssFile,
  classes: readonly CssClass[],
  linkName?: string,
): void {
  const seen = new Set<number>();
  for (const c of classes) {
    const rule = file.symbols.rules[c.rule];
    if (!rule || seen.has(c.rule)) continue;
    seen.add(c.rule);
    const context = rule.atRules.map((a) => `/* ${a} */\n`).join("");
    md.appendCodeblock(context + ruleSnippet(file.text, rule), "css");
    md.appendMarkdown(`${fileLink(file, rule.selectorStart, linkName)}\n\n`);
  }
}
