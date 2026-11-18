import * as vscode from "vscode";
import { debugTimings } from "./config.ts";

let channel: vscode.OutputChannel | undefined;

/** Runs `fn` and, with `cssCompass.debug.timings`, logs how long it took. */
export async function timed<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
  if (!debugTimings()) return fn();
  const start = performance.now();
  try {
    return await fn();
  } finally {
    channel ??= vscode.window.createOutputChannel("CSS Compass");
    channel.appendLine(`${name}: ${(performance.now() - start).toFixed(2)} ms`);
  }
}

export function disposeTiming(): void {
  channel?.dispose();
  channel = undefined;
}
