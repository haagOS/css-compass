import * as path from "node:path";
import * as vscode from "vscode";
import type { CssFile } from "../core/css-store.ts";
import { moduleExports } from "../core/module-classes.ts";
import { ruleSnippet } from "../core/preview.ts";
import { usageAt } from "../core/ts-scan.ts";
import { localsConvention } from "./config.ts";
import type { ModuleFiles } from "./module-files.ts";
import { timed } from "./timing.ts";

export class ModuleHoverProvider implements vscode.HoverProvider {
  private readonly files: ModuleFiles;

  constructor(files: ModuleFiles) {
    this.files = files;
  }

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Hover | undefined> {
    return timed("hover", async () => {
      const text = document.getText();
      const usage = usageAt(
        text,
        document.offsetAt(position),
        this.files.importsOf(document, text),
      );
      if (!usage) return undefined;
      const file = await this.files.load(document, usage.binding);
      if (!file) return undefined;
      const range = new vscode.Range(
        document.positionAt(usage.start),
        document.positionAt(usage.end),
      );
      const exports = moduleExports(file.symbols, localsConvention(document.uri));

      if (usage.kind === "binding") {
        const count = new Set(file.symbols.classes.filter((c) => c.local).map((c) => c.name)).size;
        const md = new vscode.MarkdownString();
        md.appendMarkdown(
          `CSS Module ${link(file, 0)} · ${count} ${count === 1 ? "class" : "classes"}`,
        );
        return new vscode.Hover(md, range);
      }

      const classes = exports.byName.get(usage.name);
      if (!classes?.length) return undefined;
      const md = new vscode.MarkdownString();
      const seen = new Set<number>();
      for (const c of classes) {
        const rule = file.symbols.rules[c.rule];
        if (!rule || seen.has(c.rule)) continue;
        seen.add(c.rule);
        const context = rule.atRules.map((a) => `/* ${a} */\n`).join("");
        md.appendCodeblock(context + ruleSnippet(file.text, rule), "css");
        md.appendMarkdown(link(file, rule.selectorStart) + "\n\n");
      }
      return new vscode.Hover(md, range);
    });
  }
}

/** `[name.module.css:12](file:///…#L12)` */
function link(file: CssFile, offset: number): string {
  const line = file.lines.positionAt(offset).line + 1;
  const uri = vscode.Uri.file(file.file).with({ fragment: `L${line}` });
  return `[${path.basename(file.file)}:${line}](${uri.toString()})`;
}
