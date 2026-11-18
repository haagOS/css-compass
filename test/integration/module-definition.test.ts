/// <reference types="mocha" />
// Go to Definition for CSS Module usages (SPEC §5.1, R-MC-4/5).
import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import {
  activateExtension,
  definitionsAt,
  fixture,
  isFile,
  offsetOf,
  targetSelection,
  type Definition,
} from "./helpers.ts";

const ours = (found: Definition[]) =>
  found.filter((d) => isFile(d, "b.module.css") || isFile(d, "a.module.css"));
const lines = (found: Definition[]) =>
  ours(found).map((d) => {
    const r = targetSelection(d);
    return `${r.start.line}:${r.start.character}-${r.end.character}`;
  });

suite("CSS Module definitions", () => {
  let doc: vscode.TextDocument;

  suiteSetup(async () => {
    await activateExtension();
    doc = await vscode.workspace.openTextDocument(fixture("component.tsx"));
  });

  test("the binding opens the CSS file at its start", async () => {
    const found = ours(await definitionsAt(doc, offsetOf(doc, "styles.title", 2)));
    assert.equal(found.length, 1);
    assert.ok(found[0] && isFile(found[0], "b.module.css"));
    assert.deepEqual(found[0] && targetSelection(found[0]).start, new vscode.Position(0, 0));
  });

  test("a member returns every rule of the class, in source order", async () => {
    const found = await definitionsAt(doc, offsetOf(doc, "styles.title", 9));
    assert.deepEqual(lines(found), ["0:1-6", "4:1-6", "17:3-8"]);
  });

  test("the origin is the member name", async () => {
    const found = ours(await definitionsAt(doc, offsetOf(doc, "styles.title", 9)));
    const link = found[0];
    assert.ok(link && "originSelectionRange" in link && link.originSelectionRange);
    assert.equal(doc.getText(link.originSelectionRange), "title");
  });

  test("quoted index access", async () => {
    const found = await definitionsAt(doc, offsetOf(doc, 'styles["is-active"]', 10));
    assert.deepEqual(lines(found), ["8:1-10"]);
  });

  test("namespace import", async () => {
    const found = await definitionsAt(doc, offsetOf(doc, "ns.shell", 4));
    assert.deepEqual(lines(found), ["0:1-6"]);
  });

  test("unknown class, :global class and missing file give nothing of ours", async () => {
    for (const [needle, delta] of [
      ["styles.nope", 8],
      ["styles.page", 8],
      ["missing.x", 8],
      ["missing.x", 2],
    ] as const) {
      const found = await definitionsAt(doc, offsetOf(doc, needle, delta));
      assert.deepEqual(lines(found), [], `${needle}+${delta}`);
    }
  });
});
