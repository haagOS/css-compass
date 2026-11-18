import * as vscode from "vscode";
import { globalSelectorAt } from "../core/global-selector.ts";
import { definitions } from "./global-classes.ts";
import { fileKey } from "./module-files.ts";
import { label } from "./properties.ts";
import { appendClassRules } from "./rule-hover.ts";
import type { SourceStore, SourceStores } from "./sources.ts";
import { timed } from "./timing.ts";

/**
 * Global classes in `:global(.x)` selectors of CSS files (R-CSS-4). Classes declared in the
 * current file are left out, as for custom properties (§5.3).
 */
export class CssGlobalClassProvider
  implements vscode.CompletionItemProvider, vscode.HoverProvider, vscode.DefinitionProvider
{
  static readonly triggerCharacters = ["."];
  private readonly sources: SourceStores;

  constructor(sources: SourceStores) {
    this.sources = sources;
  }

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.CompletionItem[] | undefined> {
    return timed("css global class completion", async () => {
      // Runs on every `.` typed: the check only needs the current line.
      const token = globalSelectorAt(document.lineAt(position.line).text, position.character);
      if (!token) return undefined;
      const source = await this.sources.forUri(document.uri);
      if (!source) return undefined;
      const self = fileKey(document.uri.fsPath);
      const range = new vscode.Range(position.line, token.start, position.line, token.end);
      const items: vscode.CompletionItem[] = [];
      for (const name of source.store.index.classNames()) {
        const first = others(source, name, self)[0];
        if (!first) continue;
        const item = new vscode.CompletionItem(
          { label: name, description: label(first.file) },
          vscode.CompletionItemKind.Class,
        );
        item.range = range;
        items.push(item);
      }
      return items;
    });
  }

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Hover | undefined> {
    return timed("css global class hover", async () => {
      const found = await this.lookup(document, position);
      if (!found) return undefined;
      const md = new vscode.MarkdownString();
      for (const def of found.defs) {
        const file = found.source.store.get(def.file);
        if (file) appendClassRules(md, file, [def.symbol], label(def.file));
      }
      return new vscode.Hover(md, found.range);
    });
  }

  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.LocationLink[] | undefined> {
    return timed("css global class definition", async () => {
      const found = await this.lookup(document, position);
      if (!found) return undefined;
      return found.defs.flatMap((def) => {
        const file = found.source.store.get(def.file);
        if (!file) return [];
        const a = file.lines.positionAt(def.symbol.start);
        const b = file.lines.positionAt(def.symbol.end);
        const target = new vscode.Range(a.line, a.character, b.line, b.character);
        return [
          {
            originSelectionRange: found.range,
            targetUri: vscode.Uri.file(def.file),
            targetRange: target,
          },
        ];
      });
    });
  }

  private async lookup(document: vscode.TextDocument, position: vscode.Position) {
    const token = globalSelectorAt(document.lineAt(position.line).text, position.character);
    if (!token || token.name === "") return undefined;
    const source = await this.sources.forUri(document.uri);
    if (!source) return undefined;
    const defs = others(source, token.name, fileKey(document.uri.fsPath));
    if (defs.length === 0) return undefined;
    const range = new vscode.Range(position.line, token.start, position.line, token.end);
    return { source, defs, range };
  }
}

const others = (source: SourceStore, name: string, self: string) =>
  definitions(source, name).filter((d) => d.file !== self);
