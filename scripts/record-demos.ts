// Records the README GIFs: drives a real VS Code (the integration-test download) on the demo
// workspace with Playwright, and turns screenshots into GIFs with ImageMagick (`magick` on PATH).
// Usage: pnpm build && node scripts/record-demos.ts [scene...]   (no scene: all of them)
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { _electron, type ElectronApplication, type Page } from "playwright-core";

// Code passed to page.evaluate runs in VS Code's window. The project doesn't load the DOM types
// (the extension must not use them), so these two globals are declared loosely, for this file only.
// oxlint-disable-next-line typescript/no-explicit-any
declare const document: any;
// oxlint-disable-next-line typescript/no-explicit-any
declare const NodeFilter: any;

const repo = path.resolve(import.meta.dirname, "..");
const demo = path.join(repo, "demo");
const media = path.join(repo, "docs", "media");
const work = path.join(repo, ".vscode-test", "demo");
const code = path.join(repo, ".vscode-test", "vscode-win32-x64-archive-1.146.0", "Code.exe");
const SIZE = { width: 1000, height: 560 };
/** Title and menu bar are left out of the GIFs. */
const TOP = 30;

const settings = {
  "workbench.colorTheme": "Default Dark Modern",
  "workbench.startupEditor": "none",
  "workbench.activityBar.location": "hidden",
  "workbench.secondarySideBar.defaultVisibility": "hidden",
  "workbench.tips.enabled": false,
  "workbench.enableExperiments": false,
  "workbench.layoutControl.enabled": false,
  "workbench.editor.enablePreview": false,
  "window.commandCenter": false,
  "chat.disableAIFeatures": true,
  "chat.commandCenter.enabled": false,
  "security.workspace.trust.enabled": false,
  "extensions.ignoreRecommendations": true,
  "update.mode": "none",
  "telemetry.telemetryLevel": "off",
  "git.enabled": false,
  "editor.fontSize": 15,
  "editor.lineHeight": 24,
  "editor.minimap.enabled": false,
  "editor.cursorBlinking": "solid",
  "editor.renderLineHighlight": "none",
  "editor.stickyScroll.enabled": false,
  "editor.hover.delay": 250,
  "editor.lightbulb.enabled": "off",
  "editor.inlineSuggest.enabled": false,
  "editor.occurrencesHighlight": "off",
  "editor.selectionHighlight": false,
  "editor.guides.indentation": false,
  "editor.suggest.showStatusBar": false,
  "breadcrumbs.enabled": false,
};

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  // The demo package lives outside node_modules (which git ignores), like the test fixtures.
  rmSync(path.join(demo, "node_modules"), { recursive: true, force: true });
  cpSync(
    path.join(demo, "design-system"),
    path.join(demo, "node_modules", "@acme", "design-system"),
    { recursive: true },
  );
  rmSync(work, { recursive: true, force: true });
  const userData = path.join(work, "user-data");
  mkdirSync(path.join(userData, "User"), { recursive: true });
  writeFileSync(path.join(userData, "User", "settings.json"), JSON.stringify(settings, null, 2));
  const app = await _electron.launch({
    executablePath: code,
    args: [
      demo,
      path.join(demo, "src", "components", "profile-card.tsx"),
      `--extensionDevelopmentPath=${repo}`,
      `--user-data-dir=${userData}`,
      `--extensions-dir=${path.join(work, "extensions")}`,
      "--skip-welcome",
      "--skip-release-notes",
      "--disable-workspace-trust",
      "--force-device-scale-factor=1",
      "--new-window",
    ],
  });
  const page = await app.firstWindow();
  await page.waitForSelector(".monaco-workbench", { timeout: 60_000 });
  const window = await app.browserWindow(page);
  await window.evaluate((w, size) => {
    w.unmaximize();
    w.setContentSize(size.width, size.height);
    w.center();
  }, SIZE);
  await page.waitForTimeout(1_000);
  // Hide everything but the editor, whatever the fresh profile shows.
  for (const [part, key] of [
    [".part.sidebar", "Control+B"],
    [".part.panel", "Control+J"],
    [".part.auxiliarybar", "Control+Alt+B"],
  ] as const) {
    if (await page.locator(part).isVisible()) await page.keyboard.press(key);
  }
  await page.waitForFunction(
    () => !document.body.innerText.includes("Activating Extensions"),
    null,
    { timeout: 60_000 },
  );
  // Let the TypeScript server load the project before anything is recorded.
  await page.waitForTimeout(6_000);
  await showPointer(page);
  return { app, page };
}

/** Screenshots don't contain the OS pointer: draw one that follows the mouse. */
async function showPointer(page: Page): Promise<void> {
  await page.evaluate(() => {
    // innerHTML is blocked by VS Code's Trusted Types policy: build the SVG node by node.
    const ns = "http://www.w3.org/2000/svg";
    const pointer = document.createElement("div");
    const svg = document.createElementNS(ns, "svg");
    for (const [k, v] of [
      ["width", "18"],
      ["height", "24"],
      ["viewBox", "0 0 18 24"],
    ]) {
      svg.setAttribute(k, v);
    }
    const arrow = document.createElementNS(ns, "path");
    for (const [k, v] of [
      ["d", "M1 1 L1 19 L6 14.5 L9.5 22 L12.5 20.7 L9 13.2 L15.5 13.2 Z"],
      ["fill", "white"],
      ["stroke", "black"],
      ["stroke-width", "1.3"],
      ["stroke-linejoin", "round"],
    ]) {
      arrow.setAttribute(k, v);
    }
    svg.append(arrow);
    pointer.append(svg);
    Object.assign(pointer.style, {
      position: "fixed",
      left: "-50px",
      top: "-50px",
      zIndex: "100000",
      pointerEvents: "none",
    });
    document.body.append(pointer);
    document.addEventListener(
      "mousemove",
      (e: { clientX: number; clientY: number }) => {
        pointer.style.left = `${e.clientX - 1}px`;
        pointer.style.top = `${e.clientY - 1}px`;
      },
      true,
    );
  });
}

const pause = (page: Page, ms: number) => page.waitForTimeout(ms);

/** Opens a workspace file through Quick Open. */
async function open(page: Page, name: string): Promise<void> {
  await page.keyboard.press("Control+P");
  await page.keyboard.type(name, { delay: 40 });
  await pause(page, 1_200);
  await page.keyboard.press("Enter");
  await pause(page, 900);
}

/**
 * Puts the caret on the first occurrence of `needle`, `delta` characters in, and returns the
 * caret's position on screen. Uses Ctrl+G with a line and column found in `text`.
 */
async function caretAt(
  page: Page,
  text: string,
  needle: string,
  delta = 0,
): Promise<{ x: number; y: number }> {
  const index = text.indexOf(needle);
  if (index < 0) throw new Error(`missing ${needle}`);
  const before = text.slice(0, index + delta);
  const line = before.split("\n").length;
  const column = index + delta - before.lastIndexOf("\n");
  await page.keyboard.press("Control+G");
  await page.keyboard.type(`${line}:${column}`);
  await page.keyboard.press("Enter");
  await pause(page, 200);
  const box = await page.locator(".monaco-editor.focused .cursor").first().boundingBox();
  if (!box) throw new Error(`no caret at ${needle}`);
  return { x: box.x + 2, y: box.y + box.height / 2 };
}

/**
 * Screen position of the character `delta` into the first visible `needle` in the active
 * editor. Reads the rendered lines, so it neither moves the caret nor scrolls.
 */
async function pointAt(page: Page, needle: string, delta = 0): Promise<{ x: number; y: number }> {
  const point = await page.evaluate(
    ({ wanted, offset }) => {
      const lines = document.querySelectorAll(".monaco-editor.focused .view-line");
      for (const line of lines) {
        const text = (line.textContent ?? "").replaceAll(" ", " ");
        const index = text.indexOf(wanted);
        if (index < 0) continue;
        let rest = index + offset;
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const length = node.textContent?.length ?? 0;
          if (rest < length) {
            const range = document.createRange();
            range.setStart(node, rest);
            range.setEnd(node, rest + 1);
            const box = range.getBoundingClientRect();
            return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
          }
          rest -= length;
        }
      }
      return undefined;
    },
    { wanted: needle, offset: delta },
  );
  if (!point) throw new Error(`${needle} is not visible`);
  return point;
}

/** Moves the pointer to a point in a few steps, so the movement is visible. */
async function moveTo(page: Page, at: { x: number; y: number }, dx = 0): Promise<void> {
  await page.mouse.move(at.x + dx, at.y, { steps: 12 });
}

async function ctrlClick(page: Page, at: { x: number; y: number }, dx = 0): Promise<void> {
  await moveTo(page, at, dx);
  await page.keyboard.down("Control");
  await pause(page, 500); // the underline shows the link
  await page.mouse.click(at.x + dx, at.y);
  await page.keyboard.up("Control");
}

async function type(page: Page, text: string): Promise<void> {
  await page.keyboard.type(text, { delay: 110 });
}

/** Records screenshots while `scene` runs, then writes `docs/media/<name>.gif`. */
async function record(page: Page, name: string, scene: () => Promise<void>): Promise<void> {
  const frames: { at: number; png: Buffer }[] = [];
  const clip = { x: 0, y: TOP, width: SIZE.width, height: SIZE.height - TOP };
  const state = { running: true };
  const loop = (async () => {
    while (state.running)
      frames.push({ at: performance.now(), png: await page.screenshot({ clip }) });
  })();
  try {
    await scene();
  } finally {
    state.running = false;
    await loop;
  }
  writeGif(name, frames);
}

function writeGif(name: string, frames: { at: number; png: Buffer }[]): void {
  const dir = path.join(repo, ".vscode-test", "demo-frames", name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const args: string[] = [];
  frames.forEach((frame, i) => {
    const file = path.join(dir, `${String(i).padStart(4, "0")}.png`);
    writeFileSync(file, frame.png);
    // The last frame stays a little longer before the loop restarts.
    const next = frames[i + 1]?.at ?? frame.at + 1_500;
    args.push("-delay", String(Math.max(2, Math.round((next - frame.at) / 10))), file);
  });
  mkdirSync(media, { recursive: true });
  const out = path.join(media, `${name}.gif`);
  execFileSync("magick", [...args, "-loop", "0", "-layers", "Optimize", out]);
  console.log(`${path.relative(repo, out)}: ${frames.length} frames`);
}

type Scene = (page: Page, read: (file: string) => string) => Promise<void>;

const scenes: Record<string, Scene> = {
  /** CSS Modules: hover, Ctrl+Click to the rule, completion after `styles.`. */
  "css-modules": async (page, read) => {
    const text = read("src/components/profile-card.tsx");
    await page.mouse.move(700, 420);
    await record(page, "css-modules", async () => {
      await pause(page, 600);
      await moveTo(page, await pointAt(page, "styles.card", 9));
      await pause(page, 2_600);
      await page.mouse.move(700, 420, { steps: 8 });
      await ctrlClick(page, await pointAt(page, "styles.header", 9));
      await pause(page, 2_200);
      await page.keyboard.press("Alt+ArrowLeft");
      await page.mouse.move(700, 420, { steps: 8 });
      await pause(page, 700);
      // Replace `header` in `styles.header` through completion.
      await caretAt(page, text, "styles.header", 13);
      await page.keyboard.press("Control+Shift+ArrowLeft");
      await page.keyboard.press("Backspace");
      await page.keyboard.press("Control+Space");
      await pause(page, 1_800);
      await type(page, "na");
      await pause(page, 1_000);
      await page.keyboard.press("Enter");
      await pause(page, 1_500);
    });
  },

  /** Utility classes: completion in className, hover with @layer, Ctrl+Click into the package. */
  "utility-classes": async (page, read) => {
    const text = read("src/components/profile-card.tsx");
    await page.mouse.move(700, 420);
    await record(page, "utility-classes", async () => {
      await pause(page, 600);
      await caretAt(page, text, "text-muted", 10);
      await type(page, " st");
      await pause(page, 1_800);
      await page.keyboard.press("Enter");
      await pause(page, 900);
      await moveTo(page, await pointAt(page, '"truncate"', 4));
      await pause(page, 2_800);
      await page.mouse.move(700, 470, { steps: 8 });
      await ctrlClick(page, await pointAt(page, '"text-lg"', 4));
      await pause(page, 2_600);
    });
  },

  /** Design tokens: swatches, hover with scopes and the var() chain, completion, peek. */
  "design-tokens": async (page, read) => {
    await open(page, "profile-card.module.css");
    const text = read("src/components/profile-card.module.css");
    await page.mouse.move(700, 420);
    await record(page, "design-tokens", async () => {
      await pause(page, 1_000);
      await moveTo(page, await pointAt(page, "--ds-surface", 4));
      await pause(page, 3_200);
      await page.mouse.move(700, 470, { steps: 8 });
      await caretAt(page, text, "font-weight: 600;", 17);
      await page.keyboard.press("Enter");
      await type(page, "color: var(--ds-");
      await pause(page, 1_800);
      await type(page, "acc");
      await pause(page, 900);
      await page.keyboard.press("Enter");
      await page.keyboard.press("End");
      await type(page, ";");
      await pause(page, 1_800);
    });
  },

  /** Unknown class warnings: a typo gets a squiggle and a message. */
  diagnostics: async (page, read) => {
    const text = read("src/components/profile-card.tsx");
    await page.mouse.move(700, 420);
    await record(page, "diagnostics", async () => {
      await pause(page, 600);
      await caretAt(page, text, "styles.card", 11);
      await page.keyboard.press("Control+Shift+ArrowLeft");
      await type(page, "crad");
      await page.keyboard.press("Escape");
      await pause(page, 900);
      await moveTo(page, await pointAt(page, "styles.crad", 9));
      await pause(page, 3_000);
    });
  },
};

const { readFileSync } = await import("node:fs");
const read = (file: string) => readFileSync(path.join(demo, file), "utf8").replaceAll("\r\n", "\n");
const chosen = process.argv.length > 2 ? process.argv.slice(2) : Object.keys(scenes);
for (const name of chosen) {
  const scene = scenes[name];
  if (!scene) throw new Error(`unknown scene ${name}; known: ${Object.keys(scenes).join(", ")}`);
  const { app, page } = await launch();
  try {
    await scene(page, read);
  } finally {
    await app.close();
  }
}
