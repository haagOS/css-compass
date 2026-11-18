import { build } from "esbuild";
import { cpSync, globSync, rmSync } from "node:fs";

// Test packages live outside node_modules (which git ignores) and are copied into the fixture.
const modules = "test/fixtures/vite-project/node_modules";
rmSync(modules, { recursive: true, force: true });
cpSync("test/fixtures/packages", modules, { recursive: true });

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
