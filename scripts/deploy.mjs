// One command to put your own copy on Cloudflare: `npm run deploy`.
//
// It makes sure you are logged in, creates an admin token if this Worker has none, and deploys.
// The token travels with the code in one deploy, so the Worker is never live without it.
// The token is saved in your home folder, at ~/.agent-file-optimizer-admin-token (mode 600), and is
// never printed. It is never stored in the project folder. If that file exists, its token is the one
// sent on every deploy, so the file stays the source of truth.
//
// Pass --dry-run to see what would happen without deploying or changing any secret.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tokenPath = join(homedir(), ".agent-file-optimizer-admin-token");
const dryRun = process.argv.includes("--dry-run");
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const env = { ...process.env, WRANGLER_SEND_METRICS: "false" };

const wrangler = (args, stdio = "pipe") => spawnSync(npx, ["wrangler", ...args], { cwd: root, env, encoding: "utf8", stdio });
const fail = (message) => {
  console.error(`\n${message}`);
  process.exit(1);
};

// 1. Be logged in. Log in here if not, so the first run needs no separate step.
if (wrangler(["whoami"]).status !== 0) {
  if (dryRun) console.log("Not logged in to Cloudflare. A real run would start `wrangler login` now.");
  else if (wrangler(["login"], "inherit").status !== 0) fail("Cloudflare login did not finish. Run `npx wrangler login` and try again.");
}

// 2. Find or create the admin token.
let token;
let tokenSource;
if (existsSync(tokenPath)) {
  token = readFileSync(tokenPath, "utf8").trim();
  tokenSource = "saved admin token";
} else {
  // A Worker that does not exist yet has no secrets, so a failed list also means "none".
  const listed = wrangler(["secret", "list", "--format", "json"]);
  const names = listed.status === 0 ? JSON.parse(listed.stdout || "[]").map((secret) => secret.name) : [];
  if (names.includes("ADMIN_TOKEN")) {
    fail(
      "This Worker already has an ADMIN_TOKEN, but this computer has no saved copy of it.\n" +
        `Put the existing token in ${tokenPath} (mode 600), or replace it with \`npx wrangler secret put ADMIN_TOKEN\`.\n` +
        "This script will not overwrite it silently.",
    );
  }
  token = randomBytes(32).toString("base64url");
  tokenSource = "new admin token";
  if (!dryRun) {
    writeFileSync(tokenPath, `${token}\n`, { mode: 0o600 });
    chmodSync(tokenPath, 0o600);
  }
}

if (dryRun) {
  console.log(`Would deploy with ${tokenSource}. Nothing was deployed and no secret was changed.`);
  process.exit(0);
}

// 3. Deploy the code and the token together. The secrets file lives only for this command.
const workDir = mkdtempSync(join(tmpdir(), "afo-deploy-"));
const secretsFile = join(workDir, "secrets.json");
try {
  writeFileSync(secretsFile, JSON.stringify({ ADMIN_TOKEN: token }), { mode: 0o600 });
  const deployed = wrangler(["deploy", "--secrets-file", secretsFile], "inherit");
  if (deployed.status !== 0) fail("Deploy failed. The output above shows why.");
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

console.log(`\nDeployed. Your admin token is saved at ${tokenPath}.`);
console.log("Send it as a Bearer token when creating a workspace. Keep that file private.");
