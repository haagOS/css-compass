import { build } from "esbuild";
import { globSync } from "node:fs";

await build({
  entryPoints: globSync("test/integration/*.test.ts"),
  outdir: "out/test",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node22",
  external: ["vscode"],
  logLevel: "warning",
});
