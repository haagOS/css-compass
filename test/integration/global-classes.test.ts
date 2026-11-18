/// <reference types="mocha" />
// Global classes in TS/TSX class contexts (SPEC §5.2 R-GC-1..6).
import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import type { TestApi } from "../../src/extension.ts";
import {
  activateExtension,
  definitionsAt,
  fixture,
  isFile,
  names,
  NO_FOCUS,
  offsetOf,
  revealDefinitionAt,
  waitFor,
} from "./helpers.ts";

type Item = vscode.CompletionItem;
const ours = (items: Item[]) =>
  items.filter((i) => i.kind === vscode.CompletionItemKind.Class && typeof i.label !== "string");
const labelOf = (i: Item) => (typeof i.label === "string" ? i.label : i.label.label);

async function complete(doc: vscode.TextDocument, offset: number, resolve = 0): Promise<Item[]> {
  const list = await vscode.commands.executeCommand<vscode.CompletionList>(
    "vscode.executeCompletionItemProvider",
    doc.uri,
    doc.positionAt(offset),
    undefined,
    resolve,
  );
  return ours(list.items);
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

suite("global classes in TS", () => {
  let api: TestApi;
  let doc: vscode.TextDocument;

  suiteSetup(async () => {
    api = await activateExtension();
    doc = await vscode.workspace.openTextDocument(fixture("classes.tsx"));
    await api.sources.forUri(doc.uri);
  });

  test("completion in a className string lists classes from the project and the package", async () => {
    const items = await complete(doc, offsetOf(doc, '"text-sm app-shell"', 9));
    const labels = items.map(labelOf);
    for (const name of ["text-sm", "app-shell", "hidden", "page"]) {
      assert.ok(labels.includes(name), `missing ${name} in ${labels.join(", ")}`);
    }
    const item = items.find((i) => labelOf(i) === "app-shell");
    const range = item && (item.range instanceof vscode.Range ? item.range : item.range?.replacing);
    assert.equal(range && doc.getText(range), "app-shell");
  });

  test("completion inside a multi-line clsx call, with a lazy preview", async () => {
    const items = await complete(doc, offsetOf(doc, '"app-"', 5), 50);
    const item = items.find((i) => labelOf(i) === "hidden");
    assert.ok(item);
    const docs = item.documentation;
    assert.match(typeof docs === "string" ? docs : (docs?.value ?? ""), /display: none/);
  });

  test("hover shows the rules with at-rules, workspace file first", async () => {
    const text = await hoverText(doc, offsetOf(doc, '"text-sm app-shell"', 3));
    assert.match(text, /\.text-sm \{\n {2}font-size: 0\.8rem;/);
    assert.match(text, /\/\* @layer ds\.utilities \*\//);
    assert.match(text, /\[@acme\/design-system:\d+\]\(file:/);
    assert.ok(text.indexOf("global.css") < text.indexOf("@acme/design-system"));
  });

  test("definition from clsx strings, object keys and identifier keys", async () => {
    for (const [needle, delta, file] of [
      ['"app-shell"', 3, "global.css"],
      ['"text-sm": true', 3, "style.css"],
      ["hidden: open", 2, "global.css"],
    ] as const) {
      const found = await definitionsAt(doc, offsetOf(doc, needle, delta));
      assert.ok(
        found.some((d) => isFile(d, file)),
        `${needle}: [${names(found)}]`,
      );
    }
  });

  test("Ctrl+Click lands on the workspace definition first", async function () {
    if (!(await revealDefinitionAt(doc, offsetOf(doc, '"text-sm app-shell"', 3)))) {
      console.warn(NO_FOCUS);
      this.skip();
    }
    const landed = await waitFor("Go to Definition to leave classes.tsx", () => {
      const active = vscode.window.activeTextEditor;
      return active && active.document !== doc ? active : undefined;
    });
    assert.ok(landed.document.uri.path.endsWith("/global.css"), landed.document.uri.path);
  });

  test("other strings and CSS Module index access get nothing", async () => {
    for (const [needle, delta] of [
      ['title="text-sm"', 9],
      ['styles["title"]', 10],
    ] as const) {
      const offset = offsetOf(doc, needle, delta);
      const text = await hoverText(doc, offset);
      assert.doesNotMatch(text, /global\.css|@acme\/design-system/, needle);
      assert.deepEqual(
        (await complete(doc, offset)).map(labelOf).filter((l) => l === "text-sm"),
        [],
      );
    }
  });

  test("a string outside class contexts doesn't build the index", async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder);
    const config = vscode.workspace.getConfiguration("cssCompass");
    await config.update("sources", ["src/global.css"], vscode.ConfigurationTarget.Global);
    try {
      await waitFor(
        "the index to be dropped",
        () => (api.sources.isStarted(folder) ? undefined : true),
        10_000,
      );
      const offset = offsetOf(doc, 'title="text-sm"', 9);
      await hoverText(doc, offset);
      await complete(doc, offset);
      await definitionsAt(doc, offset);
      assert.equal(api.sources.isStarted(folder), false);
    } finally {
      await config.update("sources", undefined, vscode.ConfigurationTarget.Global);
    }
  });
});
