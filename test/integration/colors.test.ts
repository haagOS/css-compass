/// <reference types="mocha" />
// Colour swatches for custom properties (SPEC §5.5 R-COL-1).
import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import type { TestApi } from "../../src/extension.ts";
import { activateExtension, fixture, waitFor } from "./helpers.ts";

const colorsOf = (uri: vscode.Uri) =>
  vscode.commands.executeCommand<vscode.ColorInformation[]>(
    "vscode.executeDocumentColorProvider",
    uri,
  );

const hex = (c: vscode.Color) =>
  [c.red, c.green, c.blue]
    .map((n) =>
      Math.round(n * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");

suite("colour swatches", () => {
  let api: TestApi;

  suiteSetup(async () => {
    api = await activateExtension();
  });

  test("var() in CSS, including rgba(var(--x-rgb), alpha); composite values get none", async () => {
    const doc = await vscode.workspace.openTextDocument(fixture("use-tokens.module.css"));
    const found = (await colorsOf(doc.uri)).map(
      (c) => `${doc.getText(c.range)} #${hex(c.color)} ${c.color.alpha}`,
    );
    assert.ok(found.includes("var(--ds-accent) #1f4e8c 1"), found.join(" | "));
    assert.ok(found.includes("rgba(var(--ds-blue-0-rgb), 0.25) #1f4e8c 0.25"), found.join(" | "));
    assert.ok(!found.some((f) => f.startsWith("var(--ds-shadow)")), found.join(" | "));
  });

  test("var() in TS strings, not in comments", async () => {
    const doc = await vscode.workspace.openTextDocument(fixture("style-props.tsx"));
    const ranges = (await colorsOf(doc.uri)).map(
      (c) => `${c.range.start.line}:${doc.getText(c.range)}`,
    );
    assert.ok(ranges.includes("0:var(--ds-accent)"), ranges.join(" | "));
    assert.ok(!ranges.some((r) => r.startsWith("4:")), ranges.join(" | "));
  });

  test("the picker keeps the original text", async () => {
    const doc = await vscode.workspace.openTextDocument(fixture("use-tokens.module.css"));
    const [first] = await colorsOf(doc.uri);
    assert.ok(first);
    const presentations = await vscode.commands.executeCommand<vscode.ColorPresentation[]>(
      "vscode.executeColorPresentationProvider",
      new vscode.Color(1, 0, 0, 1),
      { uri: doc.uri, range: first.range },
    );
    assert.ok(presentations.some((p) => p.label === doc.getText(first.range)));
  });

  test("a document without var( does not build the index", async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder);
    await vscode.workspace
      .getConfiguration("cssCompass")
      .update("sources", ["src/tokens.css"], vscode.ConfigurationTarget.Global);
    try {
      await waitFor(
        "the index to be dropped",
        () => (api.sources.isStarted(folder) ? undefined : true),
        10_000,
      );
      const doc = await vscode.workspace.openTextDocument(fixture("camel.module.css"));
      await colorsOf(doc.uri);
      assert.equal(api.sources.isStarted(folder), false);
    } finally {
      await vscode.workspace
        .getConfiguration("cssCompass")
        .update("sources", undefined, vscode.ConfigurationTarget.Global);
    }
  });
});
