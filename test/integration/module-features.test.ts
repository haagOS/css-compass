/// <reference types="mocha" />
// Hover and completion for CSS Module usages (SPEC §5.1, R-MC-7/8/11).
import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import { activateExtension, definitionsAt, fixture, isFile, offsetOf } from "./helpers.ts";

type Item = vscode.CompletionItem;
const label = (item: Item) => (typeof item.label === "string" ? item.label : item.label.label);

async function complete(doc: vscode.TextDocument, offset: number, resolve = 0): Promise<Item[]> {
  const list = await vscode.commands.executeCommand<vscode.CompletionList>(
    "vscode.executeCompletionItemProvider",
    doc.uri,
    doc.positionAt(offset),
    undefined,
    resolve,
  );
  return list.items.filter((i) => i.detail?.endsWith(".module.css"));
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
    .filter((v) => v.includes("module.css"))
    .join("\n");
}

const setConvention = (value: string | undefined) =>
  vscode.workspace
    .getConfiguration("cssCompass")
    .update("localsConvention", value, vscode.ConfigurationTarget.Global);

suite("CSS Module hover and completion", () => {
  let doc: vscode.TextDocument;

  suiteSetup(async () => {
    await activateExtension();
    doc = await vscode.workspace.openTextDocument(fixture("completion.tsx"));
  });

  suiteTeardown(() => setConvention(undefined));

  test("after `styles.` only the file's local classes are offered", async () => {
    const items = await complete(doc, offsetOf(doc, "styles.;", 7));
    assert.deepEqual(items.map(label).toSorted(), ["is-active", "title"]);
  });

  test("a name that isn't a JS identifier is inserted as an index", async () => {
    const items = await complete(doc, offsetOf(doc, "styles.;", 7));
    const item = items.find((i) => label(i) === "is-active");
    assert.ok(item);
    assert.equal(item.insertText, '["is-active"]');
    const range = item.range instanceof vscode.Range ? item.range : item.range?.replacing;
    assert.equal(range && doc.getText(range), ".");
  });

  test('inside `styles["…"]` the name is completed in the quotes', async () => {
    const items = await complete(doc, offsetOf(doc, 'styles["is-', 11));
    const item = items.find((i) => label(i) === "is-active");
    assert.ok(item);
    const range = item.range instanceof vscode.Range ? item.range : item.range?.replacing;
    assert.equal(range && doc.getText(range), "is-");
    assert.equal(item.insertText ?? label(item), "is-active");
  });

  test("the preview is filled in when an item is resolved", async () => {
    const items = await complete(doc, offsetOf(doc, "styles.;", 7), 10);
    const documentation = items.find((i) => label(i) === "is-active")?.documentation;
    const value = typeof documentation === "string" ? documentation : documentation?.value;
    assert.match(value ?? "", /font-weight: bold;/);
  });

  test("camelCase: aliases are offered, invalid originals hidden, both resolve", async () => {
    await setConvention("camelCase");
    const items = await complete(doc, offsetOf(doc, "camel.;", 6));
    assert.deepEqual(items.map(label).toSorted(), ["isActive", "plain", "titleMain"]);
    for (const [needle, delta] of [
      ["camel.isActive", 7],
      ['camel["is-active"]', 8],
    ] as const) {
      const found = await definitionsAt(doc, offsetOf(doc, needle, delta));
      assert.ok(
        found.some((d) => isFile(d, "camel.module.css")),
        needle,
      );
    }
  });

  test("camelCaseOnly: the original no longer resolves", async () => {
    await setConvention("camelCaseOnly");
    const found = await definitionsAt(doc, offsetOf(doc, 'camel["is-active"]', 8));
    assert.ok(!found.some((d) => isFile(d, "camel.module.css")));
    await setConvention(undefined);
  });

  test("hover on a member shows each rule with its context and a link", async () => {
    const text = await hoverText(doc, offsetOf(doc, "styles.title", 9));
    assert.match(text, /\.title \{\n {2}color: blue;\n\}/);
    assert.match(text, /\.title:hover/);
    assert.match(text, /\/\* @media \(min-width: 40rem\) \*\//);
    assert.match(text, /\[b\.module\.css:1\]\(file:/);
    assert.match(text, /\[b\.module\.css:18\]\(file:/);
  });

  test("hover on the binding shows the file and its class count", async () => {
    const text = await hoverText(doc, offsetOf(doc, "styles.title", 2));
    assert.match(text, /CSS Module \[b\.module\.css:1\]\(file:.*\) · 2 classes/);
  });

  test("no hover for an unknown class", async () => {
    assert.equal(await hoverText(doc, offsetOf(doc, "styles.missing", 9)), "");
  });
});
