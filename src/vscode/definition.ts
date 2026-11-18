import * as vscode from "vscode";
import type { CssFile } from "../core/css-store.ts";
import { moduleExports } from "../core/module-classes.ts";
import type { CssClass } from "../core/scan.ts";
import { usageAt } from "../core/ts-scan.ts";
import { localsConvention } from "./config.ts";
import type { ModuleFiles } from "./module-files.ts";
import { timed } from "./timing.ts";

export class ModuleDefinitionProvider implements vscode.DefinitionProvider {
  private readonly files: ModuleFiles;

  constructor(files: ModuleFiles) {
    this.files = files;
  }

  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.LocationLink[] | undefined> {
    return timed("definition", async () => {
      const text = document.getText();
      const imports = this.files.importsOf(document, text);
      const usage = usageAt(text, document.offsetAt(position), imports);
      if (!usage) return undefined;
      const file = await this.files.load(document, usage.binding);
      if (!file) return undefined;
      const origin = new vscode.Range(
        document.positionAt(usage.start),
        document.positionAt(usage.end),
      );
      const target = vscode.Uri.file(file.file);
      if (usage.kind === "binding") {
        const start = new vscode.Range(0, 0, 0, 0);
        return [{ originSelectionRange: origin, targetUri: target, targetRange: start }];
      }
      const classes = moduleExports(file.symbols, localsConvention(document.uri)).byName.get(
        usage.name,
      );
      return classes?.map((c) => ({
        originSelectionRange: origin,
        targetUri: target,
        targetRange: ruleRange(file, c),
        targetSelectionRange: range(file, c.start, c.end),
      }));
    });
  }
}

export function range(file: CssFile, start: number, end: number): vscode.Range {
  const a = file.lines.positionAt(start);
  const b = file.lines.positionAt(end);
  return new vscode.Range(a.line, a.character, b.line, b.character);
}

/** From the selector to the end of the block. */
export function ruleRange(file: CssFile, c: CssClass): vscode.Range {
  const rule = file.symbols.rules[c.rule];
  return rule ? range(file, rule.selectorStart, rule.blockEnd) : range(file, c.start, c.end);
}
