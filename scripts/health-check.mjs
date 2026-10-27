// Health check for a deployed copy: `HEALTHCHECK_URL=https://your-worker.example npm run health`.
//
// Needs no token. It checks that the Worker answers, that the landing page still sends its protective
// headers, that the capabilities endpoint responds, and that a share lookup reaches the database
// (an unknown token must return 404, not an error). It exits 1 on any failure, so a scheduled run
// that fails is the alert.
const base = (process.env.HEALTHCHECK_URL ?? "").replace(/\/+$/, "");
if (!base) {
  console.error("Set HEALTHCHECK_URL to the address of your deployment.");
  process.exit(2);
}

const failures = [];
async function check(name, path, verify) {
  try {
    const response = await fetch(`${base}${path}`, { headers: { "user-agent": "agent-file-optimizer-health-check" }, signal: AbortSignal.timeout(15000) });
    const problem = await verify(response);
    console.log(`${problem ? "FAIL" : "ok  "} ${name}${problem ? `: ${problem}` : ""}`);
    if (problem) failures.push(name);
  } catch (error) {
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : "request failed"}`);
    failures.push(name);
  }
}

await check("health endpoint", "/healthz", async (r) => (r.status === 200 && (await r.json()).ok === true ? null : `status ${r.status}`));
await check("landing page headers", "/", (r) => (r.status === 200 && r.headers.get("x-frame-options") === "DENY" && r.headers.get("content-security-policy")?.includes("frame-ancestors 'none'") ? null : `status ${r.status}, headers missing`));
await check("capabilities", "/api/capabilities", async (r) => (r.status === 200 && Array.isArray((await r.json()).parsers) ? null : `status ${r.status}`));
await check("database reachable (unknown share link is 404)", "/s/health-check-not-a-real-link", (r) => (r.status === 404 ? null : `status ${r.status}`));

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log("\nall checks passed");
