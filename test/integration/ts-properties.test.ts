/// <reference types="mocha" />
// Custom properties in TS/TSX strings (SPEC §5.4 R-TS-1, R-TS-2).
import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import { activateExtension, definitionsAt, fixture, isFile, offsetOf } from "./helpers.ts";

type Item = vscode.CompletionItem;
const ours = (items: Item[], name: string) =>
  items.find((i) => typeof i.label !== "string" && i.label.label === name && i.label.description);

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

suite("custom properties in TS strings", () => {
  let doc: vscode.TextDocument;

  suiteSetup(async () => {
    const api = await activateExtension();
    doc = await vscode.workspace.openTextDocument(fixture("style-props.tsx"));
    await api.sources.forUri(doc.uri);
  });

  test("completion inside a string after var( replaces the whole token", async () => {
    const offset = offsetOf(doc, '"var(--ds-"', 10);
    const list = await vscode.commands.executeCommand<vscode.CompletionList>(
      "vscode.executeCompletionItemProvider",
      doc.uri,
      doc.positionAt(offset),
      "-",
    );
    const item = ours(list.items, "--ds-accent");
    assert.ok(item, "no --ds-accent item");
    const range = item.range instanceof vscode.Range ? item.range : item.range?.replacing;
    assert.equal(range && doc.getText(range), "--ds-");
    assert.equal(item.documentation, "#1f4e8c");
  });

  test("hover on var(--x) in a string and in a template literal", async () => {
    assert.match(await hoverText(doc, offsetOf(doc, "var(--ds-accent)", 8)), /#1f4e8c/);
    assert.match(
      await hoverText(doc, offsetOf(doc, "var(--ds-shadow)", 8)),
      /rgba\(31, 78, 140, 0\.25\)/,
    );
  });

  test('a string that is exactly "--name" gets hover and definition', async () => {
    const offset = offsetOf(doc, '"--app-gap"', 3);
    assert.match(await hoverText(doc, offset), /4px/);
    const found = await definitionsAt(doc, offset);
    assert.ok(found.some((d) => isFile(d, "tokens.css")));
  });

  test("definition on var(--x) lists the counting definition first", async () => {
    const found = (await definitionsAt(doc, offsetOf(doc, "var(--ds-accent)", 8))).filter((d) =>
      isFile(d, "style.css"),
    );
    assert.equal(found.length, 2);
  });

  test("nothing in comments or code", async () => {
    const comment = offsetOf(doc, "// var(--ds-accent)", 10);
    assert.doesNotMatch(await hoverText(doc, comment), /#1f4e8c/);
    const found = await definitionsAt(doc, comment);
    assert.ok(!found.some((d) => isFile(d, "style.css")));
  });
});
