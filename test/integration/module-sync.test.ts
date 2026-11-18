/// <reference types="mocha" />
// CSS Module files stay current: unsaved edits win, disk changes are picked up, and opening an
// unrelated CSS file loads nothing.
import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import type { TestApi } from "../../src/extension.ts";
import {
  activateExtension,
  definitionsAt,
  fixture,
  isFile,
  offsetOf,
  waitFor,
  type Definition,
} from "./helpers.ts";

const inFile = (name: string) => (found: Definition[]) => found.filter((d) => isFile(d, name));

suite("CSS Module file sync", () => {
  let api: TestApi;
  let doc: vscode.TextDocument;

  suiteSetup(async () => {
    api = await activateExtension();
    doc = await vscode.workspace.openTextDocument(fixture("sync.tsx"));
  });

  test("an unsaved edit in an open CSS file is visible", async () => {
    const at = offsetOf(doc, "b.fresh", 3);
    assert.deepEqual(inFile("b.module.css")(await definitionsAt(doc, at)), []);

    const css = await vscode.workspace.openTextDocument(fixture("b.module.css"));
    const editor = await vscode.window.showTextDocument(css);
    try {
      await editor.edit((e) => e.insert(css.positionAt(css.getText().length), "\n.fresh {}\n"));
      assert.ok(css.isDirty);
      const found = await waitFor("the unsaved class", async () => {
        const defs = inFile("b.module.css")(await definitionsAt(doc, at));
        return defs.length > 0 ? defs : undefined;
      });
      assert.equal(found.length, 1);
    } finally {
      await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
    }
    await waitFor("the class to disappear after revert", async () =>
      inFile("b.module.css")(await definitionsAt(doc, at)).length === 0 ? true : undefined,
    );
  });

  test("a change on disk to a closed CSS file is picked up", async () => {
    const uri = fixture("watched.module.css");
    const original = await vscode.workspace.fs.readFile(uri);
    const at = offsetOf(doc, "watched.after", 9);
    assert.deepEqual(inFile("watched.module.css")(await definitionsAt(doc, at)), []);
    try {
      const changed = `${new TextDecoder().decode(original)}\n.after {\n  color: blue;\n}\n`;
      await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(changed));
      await waitFor(
        "the watcher to pick up the change",
        async () =>
          inFile("watched.module.css")(await definitionsAt(doc, at)).length ? true : undefined,
        10_000,
      );
    } finally {
      await vscode.workspace.fs.writeFile(uri, original);
    }
    await waitFor(
      "the restored file to be picked up",
      async () =>
        inFile("watched.module.css")(await definitionsAt(doc, at)).length ? undefined : true,
      10_000,
    );
  });

  test("opening an unrelated CSS file loads nothing", async () => {
    const uri = fixture("unrelated.module.css");
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
    try {
      await new Promise((resolve) => setTimeout(resolve, 200));
      assert.equal(api.moduleFiles.store.get(uri.fsPath), undefined);
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    }
  });
});
