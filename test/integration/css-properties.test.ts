/// <reference types="mocha" />
// Custom properties in CSS files (SPEC §5.3 R-CSS-1..3).
import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import { activateExtension, definitionsAt, fixture, isFile, offsetOf, waitFor } from "./helpers.ts";

type Item = vscode.CompletionItem;
const label = (item: Item) => (typeof item.label === "string" ? item.label : item.label.label);
/** Our items carry a source description; VS Code's own CSS items don't. */
const ours = (items: Item[], name: string) =>
  items.find((i) => typeof i.label !== "string" && i.label.label === name && i.label.description);
const rangeOf = (item: Item) =>
  item.range instanceof vscode.Range ? item.range : item.range?.replacing;

async function complete(doc: vscode.TextDocument, offset: number): Promise<Item[]> {
  const list = await vscode.commands.executeCommand<vscode.CompletionList>(
    "vscode.executeCompletionItemProvider",
    doc.uri,
    doc.positionAt(offset),
  );
  return list.items;
}

async function hoverText(doc: vscode.TextDocument, offset: number): Promise<string> {
  const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
    "vscode.executeHoverProvider",
    doc.uri,
    doc.positionAt(offset),
  );
  return hovers
    .flatMap((h) => h.contents)
    .map((c) => (typeof c === "string" ? c : c.value))
    .join("\n");
}

suite("custom properties in CSS", () => {
  let doc: vscode.TextDocument;

  suiteSetup(async () => {
    const api = await activateExtension();
    doc = await vscode.workspace.openTextDocument(fixture("use-tokens.module.css"));
    await api.sources.forUri(doc.uri);
  });

  test("completion after var( lists tokens from the project and the package", async () => {
    const items = await complete(doc, offsetOf(doc, "var()", 4));
    const labels = items.map(label);
    for (const name of ["--ds-accent", "--ds-blue-0", "--ds-shadow", "--app-gap"]) {
      assert.ok(labels.includes(name), `missing ${name} in ${labels.join(", ")}`);
    }
  });

  test("a token defined in this file is offered once (by VS Code's own CSS support)", async () => {
    const items = await complete(doc, offsetOf(doc, "var()", 4));
    assert.equal(items.filter((i) => label(i) === "--local-only").length, 1);
  });

  test("colour tokens carry a swatch colour, other tokens their value", async () => {
    const items = await complete(doc, offsetOf(doc, "var()", 4));
    const accent = ours(items, "--ds-accent");
    assert.equal(accent?.kind, vscode.CompletionItemKind.Color);
    assert.equal(accent?.documentation, "#1f4e8c");
    assert.equal(accent?.detail, "#1f4e8c");
    const shadow = ours(items, "--ds-shadow");
    assert.equal(shadow?.kind, vscode.CompletionItemKind.Variable);
    assert.equal(shadow?.detail, "0 2px 8px 0 rgba(31, 78, 140, 0.25)");
  });

  test("the completion replaces the whole --… token", async () => {
    const items = await complete(doc, offsetOf(doc, "var(--ds-ac)", 11));
    const item = ours(items, "--ds-accent");
    const range = item && rangeOf(item);
    assert.equal(range && doc.getText(range), "--ds-ac");
  });

  test("hover shows every definition with its scope and resolution", async () => {
    const text = await hoverText(doc, offsetOf(doc, "var(--ds-accent)", 8));
    assert.match(text, /:root/);
    assert.match(text, /var\(--ds-blue-0\)\n→ #1f4e8c/);
    assert.match(text, /\.theme-contrast/);
    assert.match(text, /#000000/);
    assert.match(text, /\[@acme\/design-system:\d+\]\(file:/);
  });

  test("go to definition returns each definition in the package", async () => {
    const found = await definitionsAt(doc, offsetOf(doc, "var(--ds-accent)", 8));
    const inPackage = found.filter((d) => isFile(d, "style.css"));
    assert.equal(inPackage.length, 2);
  });

  test("Ctrl+Click on a token of this file jumps without a peek list", async () => {
    const editor = await vscode.window.showTextDocument(doc);
    const position = doc.positionAt(offsetOf(doc, "var(--local-only)", 8));
    editor.selection = new vscode.Selection(position, position);
    await vscode.commands.executeCommand("editor.action.revealDefinition");
    await waitFor(
      "the jump to the declaration",
      () => (vscode.window.activeTextEditor?.selection.active.line === 1 ? true : undefined),
      10_000,
    );
  });
});
