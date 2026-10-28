// Browser check for the landing page: `npm run browser-check`.
//
// Drives the real page in Chrome: pick files, create, copy, open the link, revoke, and the error
// paths, plus layout and contrast spot-checks. With no BASE set it starts the Worker on local
// bindings itself. Set BASE (and ADMIN_TOKEN if the deployment asks for one) to check a live copy;
// that creates and then revokes real workspaces there. Needs Google Chrome. Exits 1 on any FAIL.
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = process.argv[2];
if (out) mkdirSync(out, { recursive: true });
const shot = async (target, name) => { if (out) await target.screenshot({ path: join(out, name), fullPage: true }); };

let base = process.env.BASE;
let worker;
let persistDir;
const stopWorker = () => {
  if (worker) {
    try { process.kill(-worker.pid, "SIGTERM"); } catch { /* already gone */ }
  }
  if (persistDir) rmSync(persistDir, { recursive: true, force: true });
};
if (!base) {
  const port = Number(process.env.BROWSER_CHECK_PORT ?? 8798);
  base = `http://127.0.0.1:${port}/`;
  persistDir = mkdtempSync(join(tmpdir(), "afo-browser-"));
  worker = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["wrangler", "dev", "--port", String(port), "--persist-to", persistDir], {
    cwd: root, env: { ...process.env, WRANGLER_SEND_METRICS: "false" }, stdio: "ignore", detached: true,
  });
  let up = false;
  for (let attempt = 0; attempt < 120 && !up; attempt += 1) {
    up = await fetch(`${base}healthz`).then((r) => r.ok).catch(() => false);
    if (!up) await sleep(1000);
  }
  if (!up) { stopWorker(); console.error("the local Worker did not start"); process.exit(1); }
}
const withAdmin = async (target) => { if (process.env.ADMIN_TOKEN) await target.fill("#admin-token", process.env.ADMIN_TOKEN); };
const report = [];
const check = (name, ok, detail = "") => report.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);

const browser = await chromium.launch({ channel: "chrome", headless: true });

// Desktop flow with real keyboard and file input.
const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
const page = await desktop.newPage();
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
await page.goto(base, { waitUntil: "load" });
await withAdmin(page);
check("page title", (await page.title()) === "Agent File Optimizer");

// Keyboard reachability: tab until the file input is focused.
let reached = false;
for (let i = 0; i < 12 && !reached; i += 1) {
  await page.keyboard.press("Tab");
  reached = await page.evaluate(() => document.activeElement && document.activeElement.id === "files");
}
check("file picker reachable by keyboard", reached);

// Create workspace with files set through the input.
await page.setInputFiles("#files", [
  { name: "brief.md", mimeType: "text/markdown", buffer: Buffer.from("# Brief\n\nShip the thing.\n") },
  { name: "scan.png", mimeType: "image/png", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]) },
]);
await shot(page, "desktop-selected.png");
await page.click("#go");
await page.waitForFunction(() => document.querySelector("#result").textContent.includes("Ready."), null, { timeout: 15000 });
const linkText = await page.textContent("#result a");
check("share link shown after create", linkText.includes("/s/"), linkText.slice(0, 60));
const resultText = await page.textContent("#result");
check("result states expiry", resultText.includes("Expires:"));
check("result warns on image original", resultText.toLowerCase().includes("original") || resultText.toLowerCase().includes("flagged") || resultText.includes("Readable notes"));
await shot(page, "desktop-result.png");

// Copy button reports status.
await page.click("#result button:nth-of-type(1)");
await page.waitForTimeout(300);
const copyLabel = await page.textContent("#result button:nth-of-type(1)");
check("copy button responds", copyLabel === "Copied" || copyLabel.startsWith("Copy failed"), copyLabel);

// The shared link actually serves the handoff.
const handoff = await page.request.get(linkText.trim());
check("share link serves handoff", handoff.status() === 200 && (await handoff.text()).includes("Agent File Optimizer handoff"));

// A person opening the link gets a readable page, not raw Markdown.
const reader = await desktop.newPage();
await reader.goto(linkText.trim(), { waitUntil: "load" });
const readerText = await reader.textContent("main");
check("share link opens as a readable page", (await reader.locator("main h1").count()) === 1 && !readerText.includes("**") && !readerText.includes("`") && /\bUTC\b/.test(readerText), readerText.slice(0, 60).replace(/\s+/g, " "));
await shot(reader, "reader.png");
await reader.close();

// Revoke from the UI, then the link must be gone.
const revoked = page.waitForResponse((r) => r.url().endsWith("/revoke") && r.request().method() === "POST");
await page.click("#result button:nth-of-type(2)");
await revoked;
await page.waitForFunction(() => document.querySelector("#result").textContent.includes("The link is off"), null, { timeout: 10000 });
const after = await page.request.get(linkText.trim());
check("revoke from UI turns link off", after.status() === 410, `status ${after.status()}`);

// Error path: reload to clear the earlier selection, then submit nothing.
await page.reload({ waitUntil: "load" });
await withAdmin(page);
await page.click("#go");
const emptyMsg = await page.textContent("#result");
check("empty submit explains what to choose", emptyMsg.includes("Choose files"));

// Error path: invalid repository is explained, not a generic failure.
await page.fill("#repo-url", "https://example.com/not-github");
await page.click("#go");
await page.waitForTimeout(1500);
const repoMsg = await page.textContent("#result");
check("bad repo URL gives a specific message", /GitHub|HTTPS|public repository/i.test(repoMsg), repoMsg.slice(0, 120));
check("no console errors on desktop flow", consoleErrors.length === 0, consoleErrors.join(" | ").slice(0, 200));

// Repository flow: pasting an address lists the files, the pre-checked ones match the defaults, and only the checked paths are sent.
// GitHub is not reachable from this check, so the two repository endpoints are answered here.
await page.reload({ waitUntil: "load" });
await withAdmin(page);
let sentBody = null;
await page.route("**/api/preview-public-repo", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ repository: "https://github.com/o/r", branch: "main", repositoryFileCount: 9, listedPaths: 9, files: [
  { path: "llms.txt", size: 120, group: "agent", checked: true },
  { path: "README.md", size: 900, group: "orientation", checked: true },
  { path: "CLAUDE.md", size: 300, group: "tool", checked: false },
] }) }));
await page.route("**/api/workspaces/*/import-public-repo", async (route) => { sentBody = JSON.parse(route.request().postData() || "{}"); await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ files: ["llms.txt"], warnings: [] }) }); });
await page.fill("#repo-url", "https://github.com/o/r");
await page.waitForSelector("#repo-picks input[data-path]", { timeout: 5000 });
const boxes = await page.$$eval("#repo-picks input[data-path]", (nodes) => nodes.map((n) => [n.dataset.path, n.checked]));
check("repo files are listed with defaults pre-checked", JSON.stringify(boxes) === JSON.stringify([["llms.txt", true], ["README.md", true], ["CLAUDE.md", false]]), JSON.stringify(boxes));
const box = await page.$eval("#repo-picks input[data-path]", (n) => { const r = n.closest("label").getBoundingClientRect(); return r.height; });
check("repo rows are touch-sized", box >= 44, `${box}px`);
await page.uncheck('#repo-picks input[data-path="README.md"]');
await page.check('#repo-picks input[data-path="CLAUDE.md"]');
await page.click("#go");
await page.waitForFunction(() => document.querySelector("#result").textContent.includes("Ready."), null, { timeout: 10000 });
check("only the checked paths are sent", sentBody && JSON.stringify(sentBody.paths.sort()) === JSON.stringify(["CLAUDE.md", "llms.txt"]) && sentBody.includeFileList === true, JSON.stringify(sentBody));
await page.unroute("**/api/preview-public-repo");
await page.unroute("**/api/workspaces/*/import-public-repo");


// Failure path: an oversized file fails at upload. The link must survive and retry must work.
await page.reload({ waitUntil: "load" });
await withAdmin(page);
await page.setInputFiles("#files", [{ name: "huge.bin", mimeType: "application/octet-stream", buffer: Buffer.alloc(11 * 1024 * 1024, 1) }]);
await page.click("#go");
await page.waitForFunction(() => document.querySelector("#result").textContent.includes("adding your content failed"), null, { timeout: 15000 });
const failMsg = await page.textContent("#result");
check("failed upload keeps the link and explains", failMsg.includes("MiB") && (await page.locator("#result a").count()) === 1, failMsg.slice(0, 140));
check("retry button label offered", (await page.textContent("#go")) === "Try adding the content again");
await page.setInputFiles("#files", [{ name: "small.md", mimeType: "text/markdown", buffer: Buffer.from("# Small\n") }]);
await page.click("#go");
await page.waitForFunction(() => document.querySelector("#result").textContent.includes("Ready."), null, { timeout: 15000 });
const retried = await page.textContent("#result");
check("changing files after failure produces a fresh ready link", retried.includes("Ready.") && !retried.includes("failed"), retried.slice(0, 60));

// Mobile layout: no horizontal scroll, controls reachable.
const mobile = await browser.newContext({ viewport: { width: 375, height: 760 }, isMobile: true, hasTouch: true });
const phone = await mobile.newPage();
await phone.goto(base, { waitUntil: "load" });
const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check("no horizontal scroll at 375px", overflow <= 0, `overflow ${overflow}px`);
const smallestTarget = await phone.evaluate(() => Math.min(...[...document.querySelectorAll("button,select,input,.drop")].map((n) => n.getBoundingClientRect().height)));
check("touch targets at least 40px tall", smallestTarget >= 40, `smallest ${Math.round(smallestTarget)}px`);
await shot(phone, "mobile-375.png");

// Contrast spot-check for muted text on the panel.
const contrast = await phone.evaluate(() => {
  const lum = (rgb) => { const [r, g, b] = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const parse = (s) => s.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
  const p = getComputedStyle(document.querySelector("p")); const card = getComputedStyle(document.querySelector(".card"));
  const a = lum(parse(p.color)); const b = lum(parse(card.backgroundColor));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
});
check("muted body text contrast >= 4.5:1", contrast >= 4.5, contrast.toFixed(2));

// The same page in a light system setting: readable text and visible control boundaries.
const lightContext = await browser.newContext({ viewport: { width: 375, height: 760 }, colorScheme: "light" });
const light = await lightContext.newPage();
await light.goto(base, { waitUntil: "load" });
const lightRatios = await light.evaluate(() => {
  const lum = (rgb) => { const [r, g, b] = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const parse = (s) => s.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
  const ratio = (x, y) => (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  const card = getComputedStyle(document.querySelector(".card")); const field = getComputedStyle(document.querySelector("select"));
  const text = ratio(lum(parse(getComputedStyle(document.querySelector("p")).color)), lum(parse(card.backgroundColor)));
  const edge = ratio(lum(parse(field.borderTopColor)), lum(parse(field.backgroundColor)));
  const bodyBg = getComputedStyle(document.body).backgroundColor;
  return { text, edge, bodyBg };
});
check("light setting: text >= 4.5:1 and control boundary >= 3:1", lightRatios.text >= 4.5 && lightRatios.edge >= 3 && lightRatios.bodyBg === "rgb(247, 244, 238)", `text ${lightRatios.text.toFixed(2)}, edge ${lightRatios.edge.toFixed(2)}, bg ${lightRatios.bodyBg}`);
await shot(light, "light-375.png");
await lightContext.close();

// Control boundaries need 3:1 against the surface they sit on (WCAG 1.4.11).
const boundary = await phone.evaluate(() => {
  const lum = (rgb) => { const [r, g, b] = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const parse = (s) => s.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
  const field = getComputedStyle(document.querySelector("select"));
  const card = getComputedStyle(document.querySelector(".card"));
  const ratio = (x, y) => (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  return Math.min(ratio(lum(parse(field.borderTopColor)), lum(parse(field.backgroundColor))), ratio(lum(parse(field.borderTopColor)), lum(parse(card.backgroundColor))));
});
check("control boundary contrast >= 3:1", boundary >= 3, boundary.toFixed(2));

if (out) writeFileSync(join(out, "report.txt"), report.join("\n") + "\n");
console.log(report.join("\n"));
await browser.close();
stopWorker();
process.exit(report.some((line) => line.startsWith("FAIL")) ? 1 : 0);
