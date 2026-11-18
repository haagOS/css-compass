import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
  files: "out/test/**/*.test.cjs",
  version: process.env.VSCODE_TEST_VERSION ?? "1.146.0",
  workspaceFolder: "test/fixtures/vite-project",
  launchArgs: ["--disable-extensions"],
  mocha: { ui: "tdd", timeout: 120_000 },
});
