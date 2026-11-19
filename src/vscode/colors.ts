import * as vscode from "vscode";
import { colorUsages } from "../core/color-usages.ts";
import { parseColor } from "../core/color.ts";
import { resolveValue } from "../core/resolve.ts";
import { contextAt } from "../core/ts-scan.ts";
import type { Properties } from "./properties.ts";
import { timed } from "./timing.ts";

/**
 * Swatches next to `var(--x)` (and `rgba(var(--x-rgb), .25)`) whose value resolves to a colour
 * (R-COL-1). Read-only: picking a colour keeps the original text. The colour range covers only
 * the function name (`var`, `rgba`): VS Code opens its picker on hover over the whole range,
 * which would push the token's own hover aside.
 */
export class PropertyColorProvider implements vscode.DocumentColorProvider {
  private readonly properties: Properties;

  constructor(properties: Properties) {
    this.properties = properties;
  }

  provideDocumentColors(document: vscode.TextDocument): Promise<vscode.ColorInformation[]> {
    return timed("colors", async () => {
      const text = document.getText();
      // Checked before touching the index, so documents without tokens never build it.
      let usages = colorUsages(text);
      if (usages.length === 0) return [];
      if (document.languageId !== "css") {
        usages = usages.filter((u) => contextAt(text, u.start) === "string");
        if (usages.length === 0) return [];
      }
      const source = await this.properties.source(document.uri);
      if (!source) return [];
      const lookup = this.properties.lookup(source);
      const colors: vscode.ColorInformation[] = [];
      for (const usage of usages) {
        const color = parseColor(resolveValue(usage.expression, lookup).value);
        if (!color) continue;
        const range = new vscode.Range(
          document.positionAt(usage.start),
          document.positionAt(usage.start + usage.expression.indexOf("(")),
        );
        colors.push(
          new vscode.ColorInformation(range, new vscode.Color(color.r, color.g, color.b, color.a)),
        );
      }
      return colors;
    });
  }

  provideColorPresentations(
    _color: vscode.Color,
    context: { document: vscode.TextDocument; range: vscode.Range },
  ): vscode.ColorPresentation[] {
    return [new vscode.ColorPresentation(context.document.getText(context.range))];
  }
}
