/// <reference types="mocha" />
// SPEC §10 risk 1: TypeScript answers Go to Definition on CSS Module usages too. These tests pin
// that behaviour and check that Ctrl+Click still lands on our result, through the contributed
// `goto` default (R-CFG-5) alone.
import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import {
  activateExtension,
  assertHas,
  definitionsAt,
  fixture,
  isFile,
  names,
  NO_FOCUS,
  offsetOf,
  revealDefinitionAt,
  waitFor,
  waitForTypeScript,
} from "./helpers.ts";

const appUri = fixture("app.tsx");
const cssUri = fixture("a.module.css");
const shellStart = new vscode.Position(0, 1);

suite("definition merging with TypeScript", () => {
  let doc: vscode.TextDocument;

  suiteSetup(async () => {
    await activateExtension();
    await waitForTypeScript();
    doc = await vscode.workspace.openTextDocument(appUri);
  });

  test("the contributed default is goto for TS/JS languages", () => {
    for (const languageId of ["typescript", "typescriptreact", "javascript", "javascriptreact"]) {
      const value = vscode.workspace
        .getConfiguration("editor", { languageId })
        .get("gotoLocation.multipleDefinitions");
      assert.equal(value, "goto", languageId);
    }
  });

  test("TypeScript answers `styles` with the ambient declaration", async () => {
    const found = await definitionsAt(doc, offsetOf(doc, "styles.shell", 1));
    assertHas(found, "css-modules.d.ts");
    assertHas(found, "a.module.css");
  });

  test("TypeScript answers `styles.shell` with the index signature", async () => {
    const found = await definitionsAt(doc, offsetOf(doc, "styles.shell", 8));
    assertHas(found, "css-modules.d.ts");
    assertHas(found, "a.module.css");
  });

  test('TypeScript does not answer `styles["shell"]`', async () => {
    const found = await definitionsAt(doc, offsetOf(doc, 'styles["shell"]', 9));
    assert.ok(
      !found.some((d) => isFile(d, "css-modules.d.ts")),
      `expected no css-modules.d.ts in [${names(found)}]`,
    );
  });

  for (const [label, needle, delta, expected] of [
    ["styles.shell", "styles.shell", 8, shellStart],
    ["styles", "styles.shell", 1, new vscode.Position(0, 0)],
  ] as const) {
    test(`Ctrl+Click lands on our result for \`${label}\``, async function () {
      // Only meaningful while TypeScript competes with a result of its own.
      const found = await definitionsAt(doc, offsetOf(doc, needle, delta));
      assert.ok(found.length >= 2, `expected a competing result in [${names(found)}]`);

      if (!(await revealDefinitionAt(doc, offsetOf(doc, needle, delta)))) {
        console.warn(NO_FOCUS);
        this.skip();
      }
      const landed = await waitFor("Go to Definition to leave app.tsx", () => {
        const active = vscode.window.activeTextEditor;
        return active && active.document.uri.toString() !== appUri.toString() ? active : undefined;
      });
      assert.equal(landed.document.uri.toString(), cssUri.toString());
      assert.deepEqual(landed.selection.start, expected);
    });
  }
});
