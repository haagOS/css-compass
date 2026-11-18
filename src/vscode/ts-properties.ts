import * as vscode from "vscode";
import {
  bareNameAt,
  propertySiteAt,
  propertyUsageAt,
  type PropertyUsage,
} from "../core/property-usage.ts";
import { contextAt } from "../core/ts-scan.ts";
import { completionItems, definitionLinks } from "./css-providers.ts";
import type { Properties } from "./properties.ts";
import { timed } from "./timing.ts";

/**
 * Custom properties in TS/JS strings and template literals: `var(--x)` (R-TS-1) and a string
 * that is exactly `--x` (R-TS-2).
 */
export class TsPropertyProvider
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
    return timed("ts property completion", async () => {
      // Runs on every `(` and `-` typed: look at the current line only.
      const line = document.lineAt(position.line).text;
      const site = propertySiteAt(line, position.character);
      if (!site || contextAt(line, site.start) !== "string") return undefined;
      const source = await this.properties.source(document.uri);
      if (!source) return undefined;
      const range = new vscode.Range(position.line, site.start, position.line, site.end);
      return completionItems(this.properties, source, range);
    });
  }

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Hover | undefined> {
    return timed("ts property hover", async () => {
      const usage = usageInString(document, position);
      if (!usage) return undefined;
      const source = await this.properties.source(document.uri);
      const md = source && this.properties.hover(source, usage.name);
      if (!md) return undefined;
      return new vscode.Hover(md, rangeOf(document, usage));
    });
  }

  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.LocationLink[] | undefined> {
    return timed("ts property definition", async () => {
      const usage = usageInString(document, position);
      if (!usage) return undefined;
      const source = await this.properties.source(document.uri);
      if (!source) return undefined;
      return definitionLinks(this.properties, source, usage.name, rangeOf(document, usage));
    });
  }
}

/** A `var(--x)` or bare `"--x"` usage, only inside a string or template text. */
function usageInString(
  document: vscode.TextDocument,
  position: vscode.Position,
): PropertyUsage | undefined {
  const text = document.getText();
  const offset = document.offsetAt(position);
  const usage = propertyUsageAt(text, offset) ?? bareNameAt(text, offset);
  if (!usage || usage.kind === "declaration") return undefined;
  return contextAt(text, usage.start) === "string" ? usage : undefined;
}

const rangeOf = (document: vscode.TextDocument, usage: PropertyUsage) =>
  new vscode.Range(document.positionAt(usage.start), document.positionAt(usage.end));
