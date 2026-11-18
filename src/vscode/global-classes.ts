import * as vscode from "vscode";
import { classTokenAt, type ClassToken } from "../core/class-context.ts";
import type { CssFile } from "../core/css-store.ts";
import { ruleSnippet } from "../core/preview.ts";
import type { CssClass } from "../core/scan.ts";
import type { Definition } from "../core/symbol-index.ts";
import { lineContext } from "../core/ts-scan.ts";
import { classFunctions } from "./config.ts";
import type { ModuleFiles } from "./module-files.ts";
import { label } from "./properties.ts";
import { appendClassRules } from "./rule-hover.ts";
import type { SourceStore, SourceStores } from "./sources.ts";
import { timed } from "./timing.ts";

class GlobalClassItem extends vscode.CompletionItem {
  readonly definition: Definition<CssClass>;
  readonly source: SourceStore;

  constructor(name: string, definition: Definition<CssClass>, source: SourceStore) {
    super({ label: name, description: label(definition.file) }, vscode.CompletionItemKind.Class);
    this.definition = definition;
    this.source = source;
  }
}

/**
 * Global classes from the sources in class contexts of TS/JS files (SPEC §5.2): `className`
 * strings and class function arguments. The class context is checked before the index is
 * touched, so other strings never build it.
 */
export class GlobalClassProvider
  implements
    vscode.CompletionItemProvider<GlobalClassItem>,
    vscode.HoverProvider,
    vscode.DefinitionProvider
{
  static readonly triggerCharacters = ['"', "'", "`", " "];
  private readonly sources: SourceStores;
  private readonly files: ModuleFiles;

  constructor(sources: SourceStores, files: ModuleFiles) {
    this.sources = sources;
    this.files = files;
  }

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<GlobalClassItem[] | undefined> {
    return timed("global class completion", async () => {
      // Runs on every quote and space typed: bail out early outside strings.
      const line = document.lineAt(position.line).text;
      if (lineContext(line, position.character) !== "string") return undefined;
      const token = this.token(document, position);
      if (!token?.completable) return undefined;
      const source = await this.sources.forUri(document.uri);
      if (!source) return undefined;
      const range = new vscode.Range(
        document.positionAt(token.start),
        document.positionAt(token.end),
      );
      const items: GlobalClassItem[] = [];
      for (const name of source.store.index.classNames()) {
        const first = definitions(source, name)[0];
        if (!first) continue;
        const item = new GlobalClassItem(name, first, source);
        item.range = range;
        items.push(item);
      }
      return items;
    });
  }

  resolveCompletionItem(item: GlobalClassItem): GlobalClassItem {
    const file = item.source.store.get(item.definition.file);
    const rule = file?.symbols.rules[item.definition.symbol.rule];
    if (file && rule) {
      const context = rule.atRules.map((a) => `/* ${a} */\n`).join("");
      item.documentation = new vscode.MarkdownString().appendCodeblock(
        context + ruleSnippet(file.text, rule),
        "css",
      );
    }
    return item;
  }

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Hover | undefined> {
    return timed("global class hover", async () => {
      const found = await this.lookup(document, position);
      if (!found) return undefined;
      const md = new vscode.MarkdownString();
      for (const { file, classes } of byFile(found.source, found.definitions)) {
        appendClassRules(md, file, classes, label(file.file));
      }
      return new vscode.Hover(md, found.range);
    });
  }

  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.LocationLink[] | undefined> {
    return timed("global class definition", async () => {
      const found = await this.lookup(document, position);
      if (!found) return undefined;
      const links: vscode.LocationLink[] = [];
      for (const def of found.definitions) {
        const file = found.source.store.get(def.file);
        const rule = file?.symbols.rules[def.symbol.rule];
        if (!file || !rule) continue;
        links.push({
          originSelectionRange: found.range,
          targetUri: vscode.Uri.file(def.file),
          targetRange: toRange(file, rule.selectorStart, rule.blockEnd),
          targetSelectionRange: toRange(file, def.symbol.start, def.symbol.end),
        });
      }
      return links;
    });
  }

  private token(document: vscode.TextDocument, position: vscode.Position): ClassToken | undefined {
    const text = document.getText();
    return classTokenAt(
      text,
      document.offsetAt(position),
      classFunctions(document.uri),
      this.files.importsOf(document, text),
    );
  }

  private async lookup(document: vscode.TextDocument, position: vscode.Position) {
    const token = this.token(document, position);
    if (!token || token.name === "") return undefined;
    const source = await this.sources.forUri(document.uri);
    if (!source) return undefined;
    const defs = definitions(source, token.name);
    if (defs.length === 0) return undefined;
    const range = new vscode.Range(
      document.positionAt(token.start),
      document.positionAt(token.end),
    );
    return { source, definitions: defs, range };
  }
}

const inNodeModules = (file: string) => /[\\/]node_modules[\\/]/.test(file);

/** Workspace files before packages, then file and position (SPEC §5.2). */
export function definitions(source: SourceStore, name: string): Definition<CssClass>[] {
  const all = source.store.index.findClass(name);
  return [
    ...all.filter((d) => !inNodeModules(d.file)),
    ...all.filter((d) => inNodeModules(d.file)),
  ];
}

function byFile(source: SourceStore, defs: readonly Definition<CssClass>[]) {
  const groups = new Map<string, { file: CssFile; classes: CssClass[] }>();
  for (const def of defs) {
    const file = source.store.get(def.file);
    if (!file) continue;
    const group = groups.get(def.file);
    if (group) group.classes.push(def.symbol);
    else groups.set(def.file, { file, classes: [def.symbol] });
  }
  return groups.values();
}

function toRange(file: CssFile, start: number, end: number): vscode.Range {
  const a = file.lines.positionAt(start);
  const b = file.lines.positionAt(end);
  return new vscode.Range(a.line, a.character, b.line, b.character);
}
