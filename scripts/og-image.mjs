// Renders the social preview images: `npm run og`. Needs Google Chrome.
//
// site/og.png (1200x630) is the Open Graph and Twitter image for the public site.
// docs/images/social-preview.png (1280x640) is the file to upload under the repository's
// Settings > Social preview, which GitHub only accepts by hand. Both come from one template, so
// they cannot drift apart. Re-run this after changing the tagline or the palette.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const template = (width, height) => `<!doctype html><html><head><meta charset="utf-8"><style>
  :root { --bg:#15171a; --panel:#1d2024; --ink:#f0efe9; --muted:#c4c8cf; --edge:#7a828c; --accent:#b9de8a; --accent-soft:#263119; }
  * { box-sizing:border-box; }
  body { margin:0; width:${width}px; height:${height}px; background:var(--bg); color:var(--ink); font-family:system-ui,-apple-system,"Segoe UI",sans-serif; display:grid; grid-template-columns:1.12fr .88fr; gap:44px; padding:64px 72px; overflow:hidden; }
  .copy { display:flex; flex-direction:column; justify-content:space-between; min-width:0; }
  .eyebrow { color:var(--accent); font:700 20px/1 ui-monospace,Menlo,monospace; letter-spacing:.14em; text-transform:uppercase; }
  h1 { font:700 78px/1.02 system-ui,-apple-system,sans-serif; letter-spacing:-.035em; margin:26px 0 22px; text-wrap:balance; }
  .sub { color:var(--muted); font-size:29px; line-height:1.4; margin:0; max-width:560px; }
  .foot { font:600 19px/1 ui-monospace,Menlo,monospace; color:var(--muted); white-space:nowrap; }
  .foot b { color:var(--ink); }
  .card { align-self:center; background:var(--panel); border:2px solid var(--edge); border-radius:26px; padding:34px; }
  .label { font:700 15px/1 ui-monospace,Menlo,monospace; letter-spacing:.12em; text-transform:uppercase; color:var(--muted); }
  .link { margin:14px 0 20px; font:600 21px/1.35 ui-monospace,Menlo,monospace; color:var(--accent); white-space:nowrap; text-decoration:underline; text-underline-offset:6px; text-decoration-thickness:2px; }
  .bar { height:12px; border-radius:99px; background:var(--accent-soft); overflow:hidden; } .bar i { display:block; height:100%; width:64%; background:var(--accent); }
  .expiry { margin:12px 0 26px; font-size:22px; color:var(--muted); }
  ul { list-style:none; margin:0; padding:0; display:grid; gap:12px; }
  li { display:flex; align-items:center; gap:14px; font:500 23px/1.2 ui-monospace,Menlo,monospace; }
  li::before { content:""; width:15px; height:15px; border-radius:4px; background:var(--accent); flex:none; }
  li.orig::before { background:transparent; border:2px solid var(--accent); }
</style></head><body>
  <div class="copy">
    <div>
      <div class="eyebrow">Open source · Self-hosted · Temporary</div>
      <h1>Hand files to an agent, then let them expire.</h1>
      <p class="sub">Agent File Optimizer turns files into one readable link that ends on its own.</p>
    </div>
    <div class="foot"><b>github.com</b>/rmichaelthomas/agent-file-optimizer</div>
  </div>
  <div class="card">
    <div class="label">Share link</div>
    <div class="link">your-worker.dev/s/••••••••</div>
    <div class="bar"><i></i></div>
    <div class="expiry">Expires in 6 hours · revoke any time</div>
    <ul><li>handoff.md</li><li>manifest.json</li><li>content.md</li><li class="orig">original/…</li></ul>
  </div>
</body></html>`;

const browser = await chromium.launch({ channel: "chrome", headless: true });
for (const [file, width, height] of [["site/og.png", 1200, 630], ["docs/images/social-preview.png", 1280, 640]]) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(template(width, height));
  mkdirSync(dirname(join(root, file)), { recursive: true });
  await page.screenshot({ path: join(root, file), type: "png" });
  await page.close();
  console.log(`wrote ${file} (${width}x${height})`);
}
await browser.close();
