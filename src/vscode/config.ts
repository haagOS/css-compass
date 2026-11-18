import * as vscode from "vscode";
import { LOCALS_CONVENTIONS, type LocalsConvention } from "../core/locals-convention.ts";

const SECTION = "cssCompass";

/** Read on every request, so changes apply without a reload (R-CFG-4). */
export function localsConvention(scope: vscode.Uri): LocalsConvention {
  const value = vscode.workspace.getConfiguration(SECTION, scope).get<string>("localsConvention");
  return LOCALS_CONVENTIONS.find((c) => c === value) ?? "asIs";
}

export function debugTimings(): boolean {
  return vscode.workspace.getConfiguration(SECTION).get<boolean>("debug.timings") ?? false;
}
