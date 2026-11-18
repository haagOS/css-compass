/// <reference types="mocha" />
// Global classes in :global(.x) selectors of CSS files (SPEC §5.3 R-CSS-4).
import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import { activateExtension, definitionsAt, fixture, isFile, names, offsetOf } from "./helpers.ts";

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

suite("global classes in :global(…)", () => {
  let doc: vscode.TextDocument;

  suiteSetup(async () => {
    const api = await activateExtension();
    doc = await vscode.workspace.openTextDocument(fixture("global-use.module.css"));
    await api.sources.forUri(doc.uri);
  });

  test("hover and definition point at the global rule", async () => {
    const offset = offsetOf(doc, ".app-shell)", 3);
    assert.match(await hoverText(doc, offset), /\.app-shell \{\n {2}display: grid;/);
    const found = await definitionsAt(doc, offset);
    assert.ok(
      found.some((d) => isFile(d, "global.css")),
      names(found),
    );
  });

  test("a class declared only by this file gets nothing of ours", async () => {
    const offset = offsetOf(doc, ".own-global)", 3);
    assert.doesNotMatch(await hoverText(doc, offset), /global-use\.module\.css:/);
    const found = await definitionsAt(doc, offset);
    assert.ok(!found.some((d) => isFile(d, "global-use.module.css")), names(found));
  });

  test("completion after :global(. offers other files' classes", async () => {
    const list = await vscode.commands.executeCommand<vscode.CompletionList>(
      "vscode.executeCompletionItemProvider",
      doc.uri,
      doc.positionAt(offsetOf(doc, ".te)", 3)),
    );
    const labels = list.items
      .filter((i) => typeof i.label !== "string" && i.label.description)
      .map((i) => (typeof i.label === "string" ? i.label : i.label.label));
    assert.ok(labels.includes("text-sm"), labels.join(", "));
    assert.ok(!labels.includes("own-global"), labels.join(", "));
  });
});
