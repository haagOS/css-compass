import * as path from "node:path";
import * as vscode from "vscode";
import type { CssFile } from "../core/css-store.ts";
import { isIdentifier } from "../core/locals-convention.ts";
import { moduleExports } from "../core/module-classes.ts";
import { declarations } from "../core/preview.ts";
import type { CssClass } from "../core/scan.ts";
import { completionSiteAt } from "../core/ts-scan.ts";
import { localsConvention } from "./config.ts";
import type { ModuleFiles } from "./module-files.ts";
import { timed } from "./timing.ts";

class ClassCompletionItem extends vscode.CompletionItem {
  readonly file: CssFile;
  readonly classes: readonly CssClass[];

  constructor(label: string, file: CssFile, classes: readonly CssClass[]) {
    super(label, vscode.CompletionItemKind.Value);
    this.file = file;
    this.classes = classes;
  }
}

export class ModuleCompletionProvider implements vscode.CompletionItemProvider<ClassCompletionItem> {
  static readonly triggerCharacters = [".", '"', "'"];
  private readonly files: ModuleFiles;

  constructor(files: ModuleFiles) {
    this.files = files;
  }

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<ClassCompletionItem[] | undefined> {
    return timed("completion", async () => {
      const text = document.getText();
      const site = completionSiteAt(
        text,
        document.offsetAt(position),
        this.files.importsOf(document, text),
      );
      if (!site) return undefined;
      const file = await this.files.load(document, site.binding);
      if (!file) return undefined;
      const exports = moduleExports(file.symbols, localsConvention(document.uri));
      const at = (offset: number) => document.positionAt(offset);
      const wordRange = new vscode.Range(at(site.start), at(site.end));

      return exports.completionNames.map((name) => {
        const item = new ClassCompletionItem(name, file, exports.byName.get(name) ?? []);
        item.detail = path.basename(file.file);
        if (site.kind === "member" && !isIdentifier(name)) {
          // `styles.a-b` is not valid JS: rewrite the `.` too.
          item.range = new vscode.Range(at(site.dot), at(site.end));
          item.insertText = `[${JSON.stringify(name)}]`;
          item.filterText = `.${name}`;
        } else {
          item.range = wordRange;
        }
        return item;
      });
    });
  }

  resolveCompletionItem(item: ClassCompletionItem): ClassCompletionItem {
    const rule = item.file.symbols.rules[item.classes[0]?.rule ?? -1];
    if (rule) {
      const lines = declarations(item.file.text, rule).map((d) => `  ${d};`);
      const selector = item.file.text.slice(rule.selectorStart, rule.selectorEnd);
      item.documentation = new vscode.MarkdownString().appendCodeblock(
        `${selector} {\n${lines.join("\n")}\n}`,
        "css",
      );
    }
    return item;
  }
}
