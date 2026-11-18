/// <reference types="mocha" />
// Unknown CSS Module class warnings (SPEC R-MC-10).
import * as assert from "node:assert/strict";
import * as vscode from "vscode";
import { activateExtension, fixture, waitFor } from "./helpers.ts";

const config = () => vscode.workspace.getConfiguration("cssCompass");

suite("unknown CSS Module class warnings", () => {
  let doc: vscode.TextDocument;

  /** Text of each CSS Compass warning range, in document order. */
  const warnings = (): string[] =>
    vscode.languages
      .getDiagnostics(doc.uri)
      .filter((d) => d.source === "CSS Compass")
      .toSorted((a, b) => a.range.start.compareTo(b.range.start))
      .map((d) => doc.getText(d.range));

  const waitForWarnings = (expected: string[], what: string) =>
    waitFor(
      what,
      () => (JSON.stringify(warnings()) === JSON.stringify(expected) ? true : undefined),
      15_000,
    ).catch((error: unknown) => {
      assert.deepEqual(warnings(), expected, String(error));
    });

  suiteSetup(async () => {
    await activateExtension();
    doc = await vscode.workspace.openTextDocument(fixture("diagnostics.tsx"));
  });

  test("unknown member and index names are flagged; known names, missing files and strings are not", async () => {
    await waitForWarnings(["missing", "nope", "titleMain"], "the first check");
    const [first] = vscode.languages.getDiagnostics(doc.uri);
    assert.equal(first?.severity, vscode.DiagnosticSeverity.Warning);
    assert.match(first?.message ?? "", /Unknown class "missing" in \.\/a\.module\.css/);
  });

  test("localsConvention camelCase accepts the alias", async () => {
    await config().update("localsConvention", "camelCase", vscode.ConfigurationTarget.Global);
    try {
      await waitForWarnings(["missing", "nope"], "titleMain to be accepted");
    } finally {
      await config().update("localsConvention", undefined, vscode.ConfigurationTarget.Global);
    }
    await waitForWarnings(["missing", "nope", "titleMain"], "titleMain to be flagged again");
  });

  test("an unsaved edit in the CSS file clears the warning", async () => {
    const css = await vscode.workspace.openTextDocument(fixture("a.module.css"));
    const editor = await vscode.window.showTextDocument(css);
    try {
      await editor.edit((e) => e.insert(css.positionAt(css.getText().length), "\n.missing {}\n"));
      await waitForWarnings(["nope", "titleMain"], "the unsaved class to count");
    } finally {
      await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
    }
    await waitForWarnings(["missing", "nope", "titleMain"], "the warning after revert");
  });

  test("a file created later is checked, and deleting it clears its warnings", async () => {
    const uri = fixture("temp-diagnostics.module.css");
    try {
      await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(".other {}\n"));
      await waitForWarnings(["missing", "nope", "titleMain", "added"], "the new file to count");
    } finally {
      await vscode.workspace.fs.delete(uri);
    }
    await waitForWarnings(["missing", "nope", "titleMain"], "the deleted file's warning to go");
  });

  test("turning the setting off clears the warnings", async () => {
    await config().update(
      "diagnostics.unknownModuleClass",
      false,
      vscode.ConfigurationTarget.Global,
    );
    try {
      await waitForWarnings([], "the warnings to clear");
    } finally {
      await config().update(
        "diagnostics.unknownModuleClass",
        undefined,
        vscode.ConfigurationTarget.Global,
      );
    }
    await waitForWarnings(["missing", "nope", "titleMain"], "the warnings to return");
  });
});

suite("unknown global class warnings", () => {
  let doc: vscode.TextDocument;

  const warnings = (): string[] =>
    vscode.languages
      .getDiagnostics(doc.uri)
      .filter((d) => d.code === "unknown-global-class")
      .toSorted((a, b) => a.range.start.compareTo(b.range.start))
      .map((d) => doc.getText(d.range));

  const waitForWarnings = (expected: string[], what: string) =>
    waitFor(
      what,
      () => (JSON.stringify(warnings()) === JSON.stringify(expected) ? true : undefined),
      15_000,
    ).catch((error: unknown) => {
      assert.deepEqual(warnings(), expected, String(error));
    });

  suiteSetup(async () => {
    await activateExtension();
    doc = await vscode.workspace.openTextDocument(fixture("global-diagnostics.tsx"));
  });

  test("off by default", async () => {
    // Give a check the time to run; nothing may appear.
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    assert.deepEqual(warnings(), []);
  });

  test("when on, unknown names in class contexts are flagged; dynamic templates and other strings are not", async () => {
    await config().update(
      "diagnostics.unknownGlobalClass",
      true,
      vscode.ConfigurationTarget.Global,
    );
    try {
      await waitForWarnings(["typo-class", "nope-key"], "the global class warnings");

      // No sources found: nothing is flagged rather than everything.
      await config().update("sources", ["no-such-dir/**/*.css"], vscode.ConfigurationTarget.Global);
      try {
        await waitForWarnings([], "the warnings to clear without sources");
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        assert.deepEqual(warnings(), []);
      } finally {
        await config().update("sources", undefined, vscode.ConfigurationTarget.Global);
      }
      await waitForWarnings(["typo-class", "nope-key"], "the warnings to return with sources");
    } finally {
      await config().update(
        "diagnostics.unknownGlobalClass",
        undefined,
        vscode.ConfigurationTarget.Global,
      );
    }
    await waitForWarnings([], "the warnings to clear when off");
  });
});
