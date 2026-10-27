// First-run check for a fresh clone: `npm run smoke`.
//
// Starts the Worker on local bindings, creates a workspace, uploads a file, and reads it back
// through the share link. It needs no Cloudflare account and no separate migration step, so it
// fails the same way a new clone would if the schema did not come up on its own.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.SMOKE_PORT ?? 8797);
const base = `http://127.0.0.1:${port}`;
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const persistDir = mkdtempSync(join(tmpdir(), "afo-smoke-"));

const worker = spawn(npx, ["wrangler", "dev", "--port", String(port), "--persist-to", persistDir], {
  cwd: root,
  env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
});
let logs = "";
worker.stdout.on("data", (chunk) => (logs += chunk));
worker.stderr.on("data", (chunk) => (logs += chunk));

const stop = () => {
  try {
    process.kill(-worker.pid, "SIGTERM");
  } catch {
    // The group may already be gone.
  }
  rmSync(persistDir, { recursive: true, force: true });
};

function check(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  let up = false;
  for (let attempt = 0; attempt < 120 && !up; attempt++) {
    up = await fetch(`${base}/healthz`).then((r) => r.ok).catch(() => false);
    if (!up) await sleep(1000);
  }
  check(up, "the local Worker did not start");

  const created = await fetch(`${base}/api/workspaces`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ intent: "agent-understanding", windowHours: 1 }),
  });
  check(created.status === 201, `creating a workspace returned ${created.status}`);
  const workspace = await created.json();

  const form = new FormData();
  form.set("file", new Blob(["# Smoke\n\nHello from the first-run check.\n"], { type: "text/markdown" }), "notes.md");
  const uploaded = await fetch(`${base}/api/workspaces/${workspace.id}/upload`, {
    method: "POST",
    headers: { authorization: `Bearer ${workspace.uploadToken}` },
    body: form,
  });
  check(uploaded.status === 201, `uploading a file returned ${uploaded.status}`);

  const share = workspace.shareUrl.replace(/^https?:\/\/[^/]+/, base);
  const handoff = await fetch(share).then((r) => r.text());
  check(handoff.includes("Start here"), "handoff.md did not come back through the share link");
  const original = await fetch(`${share}/original/notes.md`).then((r) => r.text());
  check(original.includes("Hello from the first-run check."), "the original file did not come back unchanged");

  console.log("smoke passed: create, upload, handoff, and original read through a share link");
} catch (error) {
  console.error(`smoke failed: ${error.message}`);
  console.error(logs.slice(-3000));
  process.exitCode = 1;
} finally {
  stop();
}
