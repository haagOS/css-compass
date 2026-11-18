import * as vscode from "vscode";
import { propertySiteAt, propertyUsageAt } from "../core/property-usage.ts";
import { range as fileRange } from "./definition.ts";
import { fileKey } from "./module-files.ts";
import { label, Properties } from "./properties.ts";
import type { SourceStore } from "./sources.ts";
import { timed } from "./timing.ts";

/**
 * Custom properties in CSS files (R-CSS-1..3). Definitions in the current document are left to
 * VS Code's own CSS support, which already completes and resolves them (SPEC §5.3).
 */
export class CssPropertyProvider
  implements vscode.CompletionItemProvider, vscode.HoverProvider, vscode.DefinitionProvider
{
  static readonly triggerCharacters = ["(", "-"];
  private readonly properties: Properties;

  constructor(properties: Properties) {
    this.properties = properties;
  }

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.CompletionItem[] | undefined> {
    return timed("css completion", async () => {
      const site = propertySiteAt(document.getText(), document.offsetAt(position));
      if (!site) return undefined;
      const source = await this.properties.source(document.uri);
      if (!source) return undefined;
      const range = new vscode.Range(
        document.positionAt(site.start),
        document.positionAt(site.end),
      );
      return completionItems(this.properties, source, range, fileKey(document.uri.fsPath));
    });
  }

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Hover | undefined> {
    return timed("css hover", async () => {
      const usage = propertyUsageAt(document.getText(), document.offsetAt(position));
      if (!usage) return undefined;
      const source = await this.properties.source(document.uri);
      const md = source && this.properties.hover(source, usage.name);
      if (!md) return undefined;
      const range = new vscode.Range(
        document.positionAt(usage.start),
        document.positionAt(usage.end),
      );
      return new vscode.Hover(md, range);
    });
  }

  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.LocationLink[] | undefined> {
    return timed("css definition", async () => {
      const usage = propertyUsageAt(document.getText(), document.offsetAt(position));
      if (usage?.kind !== "var") return undefined;
      const source = await this.properties.source(document.uri);
      if (!source) return undefined;
      const self = fileKey(document.uri.fsPath);
      const origin = new vscode.Range(
        document.positionAt(usage.start),
        document.positionAt(usage.end),
      );
      return definitionLinks(this.properties, source, usage.name, origin, self);
    });
  }
}

/** Links to every definition outside `exclude`, the counting one first. */
export function definitionLinks(
  properties: Properties,
  source: SourceStore,
  name: string,
  origin: vscode.Range,
  exclude?: string,
): vscode.LocationLink[] {
  const links: vscode.LocationLink[] = [];
  for (const def of properties.definitions(source, name)) {
    if (def.file === exclude) continue;
    const file = source.store.get(def.file);
    if (!file) continue;
    const rule = file.symbols.rules[def.symbol.rule];
    links.push({
      originSelectionRange: origin,
      targetUri: vscode.Uri.file(def.file),
      targetRange: rule
        ? fileRange(file, rule.selectorStart, rule.blockEnd)
        : fileRange(file, def.symbol.start, def.symbol.valueEnd),
      targetSelectionRange: fileRange(file, def.symbol.start, def.symbol.end),
    });
  }
  return links;
}

/**
 * One item per custom property, with the resolved value and a swatch for colours. Names whose
 * only definitions are in `exclude` are left out.
 */
export function completionItems(
  properties: Properties,
  source: SourceStore,
  range: vscode.Range,
  exclude?: string,
): vscode.CompletionItem[] {
  const items: vscode.CompletionItem[] = [];
  for (const name of source.store.index.propertyNames()) {
    const resolved = properties.resolve(source, name);
    if (!resolved) continue;
    const defs = source.store.index.findProperty(name);
    if (exclude !== undefined && defs.every((d) => d.file === exclude)) continue;
    const color = resolved.color;
    const item = new vscode.CompletionItem(
      { label: name, description: label(resolved.counting.file) },
      color ? vscode.CompletionItemKind.Color : vscode.CompletionItemKind.Variable,
    );
    item.range = range;
    item.detail = resolved.value;
    if (color) item.documentation = Properties.colorText(color);
    items.push(item);
  }
  return items;
}
