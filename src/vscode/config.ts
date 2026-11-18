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

const DEFAULT_CLASS_FUNCTIONS = ["clsx", "cn", "cx", "classnames"];

/** Functions whose arguments are class contexts (§5.2). */
export function classFunctions(scope: vscode.Uri): string[] {
  const value = vscode.workspace.getConfiguration(SECTION, scope).get<unknown>("classFunctions");
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : DEFAULT_CLASS_FUNCTIONS;
}
