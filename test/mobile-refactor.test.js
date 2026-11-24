import { afterAll, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { chromium, webkit } from "playwright";

const ROOT = resolve(import.meta.dir, "..");
const PUBLIC = join(ROOT, "public");
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
};

describe("public/index.html modular refactor", () => {
  const html = readFileSync(join(PUBLIC, "index.html"), "utf8");
  const css = readFileSync(join(PUBLIC, "styles.css"), "utf8");

  it("extracts inline style and script into external Capacitor-compatible assets", () => {
    const htmlLines = html.split("\n").length;
    expect(htmlLines).toBeLessThan(600);
    expect(html).not.toMatch(/<style[\s>]/i);
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
    expect(html).not.toMatch(/type=["']module["']/i);
    expect(html).toContain('<link rel="stylesheet" href="styles.css">');

    const cap = JSON.parse(readFileSync(join(ROOT, "capacitor.config.json"), "utf8"));
    expect(cap.webDir).toBe("public");
    expect(cap.server?.iosScheme).toBe("capacitor");
  });

  it("resolves every referenced stylesheet and script under public/ and passes node --check", () => {
    const cssLinks = [...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["']/gi)].map((m) => m[1]);
    const scriptSrcs = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]);

    expect(cssLinks).toEqual(["styles.css"]);
    expect(scriptSrcs.length).toBeGreaterThanOrEqual(12);
    expect(scriptSrcs.some((s) => s.startsWith("js/core.js"))).toBe(true);
    expect(scriptSrcs.some((s) => s.startsWith("js/boot.js"))).toBe(true);
    expect(scriptSrcs[scriptSrcs.length - 1]).toBe("mascot-react.js");

    for (const rel of [...cssLinks, ...scriptSrcs]) {
      const cleanRel = rel.split("?")[0];
      const fullPath = join(PUBLIC, cleanRel);
      expect(existsSync(fullPath)).toBe(true);
      expect(readFileSync(fullPath, "utf8").trim().length).toBeGreaterThan(0);
      if (cleanRel.endsWith(".js")) {
        execFileSync("node", ["--check", fullPath], { stdio: "pipe" });
      }
    }

    for (const file of readdirSync(join(PUBLIC, "js"))) {
      expect(file.endsWith(".js")).toBe(true);
      const src = readFileSync(join(PUBLIC, "js", file), "utf8");
      expect(src).not.toMatch(/^\s*(?:import|export)\s/m);
      execFileSync("node", ["--check", join(PUBLIC, "js", file)], { stdio: "pipe" });
    }
  });

  it("preserves critical DOM IDs, iOS 16px zoom invariants, and Wave-7 helpers", () => {
    const requiredIds = [
      "menuBtn", "modelBtn", "modelName", "newBtn", "chatView", "chatScroll",
      "hero", "mascot", "thread", "composer", "prompt", "sendBtn", "micBtn",
      "composerModes", "webChip", "imgChip", "webModeChip", "imgModeChip",
      "imgAspectBtn", "slashMenu", "attachBar", "tableModal", "tableModalFilter",
      "tableModalMd", "tableModalSum", "drawer", "scrim", "modelSheet",
      "voiceSheet", "sourcesSheet", "botSheet", "f-voice", "f-welcome",
      "f-botform", "f-discover", "f-botdetail", "f-mybots", "f-account",
      "f-agent", "f-image", "f-settings",
    ];
    for (const id of requiredIds) {
      expect(html).toContain(`id="${id}"`);
    }

    // b6e62ea: iOS Safari/WKWebView auto-zoom prevention on inputs
    expect(css).toMatch(/\.md-table-filter,\.table-modal-filter\{[^}]*font-size:16px/);
    expect(css).toMatch(/\.search input\{[^}]*font-size:16px/);
    expect(css).toMatch(/form\.composer textarea\{[^}]*font:16px/);

    // Wave-7 parity & deduplication helpers
    const markdownJs = readFileSync(join(PUBLIC, "js/markdown.js"), "utf8");
    const chatJs = readFileSync(join(PUBLIC, "js/chat.js"), "utf8");
    const coreJs = readFileSync(join(PUBLIC, "js/core.js"), "utf8");

    expect(markdownJs).toContain("function tableToMarkdown(");
    expect(markdownJs).toContain("function computeTableSummary(");
    expect(markdownJs).toContain("function toggleTableSummary(");
    expect(markdownJs).toContain("function filterTableRows(");
    expect(chatJs).toContain("function syncMobileComposerModes(");
    expect(chatJs).toContain("function syncMobileSlashMenu(");
    expect(chatJs).toContain("function exportMobileConvoMarkdown(");
    expect(coreJs).toContain("function copyWithFeedback(");
    expect(coreJs).toContain("function triggerBlobDownload(");
    expect(coreJs).toContain("function slugifyFilename(");
  });
});

describe("browser runtime smoke check", () => {
  let srv;
  let browser;

  afterAll(async () => {
    try { await browser?.close(); } catch {}
    try { srv?.stop(true); } catch {}
  });

  it("loads public/index.html in headless WebKit/Chromium with zero runtime errors and working Wave-7 UI", async () => {
    if (!existsSync(webkit.executablePath()) && !existsSync(CHROME_PATH)) return;

    srv = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(req) {
        const pathname = new URL(req.url).pathname;
        const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
        const full = resolve(PUBLIC, rel);
        if (!full.startsWith(PUBLIC) || !existsSync(full)) {
          return new Response("Not Found", { status: 404 });
        }
        const type = MIME[extname(full)] || "application/octet-stream";
        return new Response(Bun.file(full), { headers: { "Content-Type": type } });
      },
    });

    browser = existsSync(webkit.executablePath())
      ? await webkit.launch({ headless: true })
      : await chromium.launch({
          executablePath: CHROME_PATH,
          headless: true,
          args: ["--no-sandbox", "--disable-gpu"],
        });

    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();

    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err.message || String(err)));

    await page.route("https://nakata.app/**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ models: [], voices: [], categories: [] }) }),
    );

    await page.addInitScript(() => {
      localStorage.setItem("nakata_welcomed", "true");
    });

    await page.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#mascot svg.bot-orb");

    const runtime = await page.evaluate(() => {
      const bindings = {
        $: typeof $,
        el: typeof el,
        orb: typeof orb,
        orbColor: typeof orbColor,
        haptic: typeof haptic,
        LS: typeof LS,
        tx: typeof tx,
        i18nApply: typeof i18nApply,
        md: typeof md,
        tableToMarkdown: typeof tableToMarkdown,
        computeTableSummary: typeof computeTableSummary,
        toggleTableSummary: typeof toggleTableSummary,
        syncMobileComposerModes: typeof syncMobileComposerModes,
        submitMobilePrompt: typeof submitMobilePrompt,
        send: typeof send,
        startVoice: typeof startVoice,
        openSettings: typeof openSettings,
        openBotSheet: typeof openBotSheet,
        openAccount: typeof openAccount,
        NakataTravelResearch: typeof window.NakataTravelResearch,
        __mascotReact: typeof window.__mascotReact,
      };
      const missing = Object.entries(bindings).filter(([, t]) => t === "undefined").map(([k]) => k);

      // Slash menu check
      const promptEl = document.querySelector("#prompt");
      promptEl.value = "/w";
      promptEl.dispatchEvent(new Event("input", { bubbles: true }));
      const slashVisible = !document.querySelector("#slashMenu").hidden;
      promptEl.value = "";
      promptEl.dispatchEvent(new Event("input", { bubbles: true }));

      // Wave-7 composer mode bar & aspect ratio cycling
      document.querySelector("#webChip").click();
      document.querySelector("#imgChip").click();
      document.querySelector("#imgAspectBtn").click();
      const webPressed = document.querySelector("#webChip").getAttribute("aria-pressed");
      const imgPressed = document.querySelector("#imgChip").getAttribute("aria-pressed");
      const aspectText = document.querySelector("#imgAspectBtn").textContent;
      const modesHidden = document.querySelector("#composerModes").hidden;

      // Render GFM table & verify Wave-7 Markdown copy + live numeric summary + 16px input font-size
      const host = document.createElement("div");
      host.className = "md";
      host.innerHTML = md("| Plan | Price |\n|---|---:|\n| Basic | $10 |\n| Pro | $20 |\n| Team | $40 |\n| Enterprise | $80 |");
      document.body.append(host);
      const tbl = host.querySelector("table");
      const mdOut = tableToMarkdown(tbl);
      const sumBtn = host.querySelector("[data-sum-table]");
      toggleTableSummary(tbl, sumBtn);
      const footText = tbl.querySelector("tfoot.md-table-summary")?.textContent || "";
      const filterInput = host.querySelector(".md-table-filter");
      const filterFontSize = filterInput ? getComputedStyle(filterInput).fontSize : "";
      host.remove();

      return { missing, slashVisible, webPressed, imgPressed, aspectText, modesHidden, mdOut, footText, filterFontSize };
    });

    expect(pageErrors).toEqual([]);
    expect(runtime.missing).toEqual([]);
    expect(runtime.slashVisible).toBe(true);
    expect(runtime.webPressed).toBe("true");
    expect(runtime.imgPressed).toBe("true");
    expect(runtime.aspectText).toBe("1:1");
    expect(runtime.modesHidden).toBe(false);
    expect(runtime.mdOut).toContain("| Plan | Price |");
    expect(runtime.footText).toContain("37.5");
    expect(runtime.filterFontSize).toBe("16px");
  }, 20000);
});
