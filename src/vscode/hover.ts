import * as vscode from "vscode";
import { moduleExports } from "../core/module-classes.ts";
import { usageAt } from "../core/ts-scan.ts";
import { localsConvention } from "./config.ts";
import type { ModuleFiles } from "./module-files.ts";
import { appendClassRules, fileLink } from "./rule-hover.ts";
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
          `CSS Module ${fileLink(file, 0)} · ${count} ${count === 1 ? "class" : "classes"}`,
        );
        return new vscode.Hover(md, range);
      }

      const classes = exports.byName.get(usage.name);
      if (!classes?.length) return undefined;
      const md = new vscode.MarkdownString();
      appendClassRules(md, file, classes);
      return new vscode.Hover(md, range);
    });
  }
}
