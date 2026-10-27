import { createApp } from "./app";
import { expireDue, servicesForEnv } from "./lifecycle";
import { ensureSchema } from "./schema";
import type { AppEnv } from "./types";
import { renderLandingPage } from "./ui";

// The page's own inline script and style still run. The policy only stops it being framed, sniffed, or talking to other origins.
const LANDING_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

// One counter per caller address and route class (share reads, or API calls). The address is used only as
// the counter's key inside Cloudflare's rate limiter; this code does not store or log it.
async function rateLimited(request: Request, env: AppEnv): Promise<Response | null> {
  if (!env.RATE_LIMITER) return null;
  const path = new URL(request.url).pathname;
  if (path === "/healthz") return null;
  const routeClass = path.startsWith("/s/") ? "share" : "api";
  const caller = request.headers.get("cf-connecting-ip") ?? "unknown";
  const outcome = await env.RATE_LIMITER.limit({ key: `${routeClass}:${caller}` });
  if (outcome.success) return null;
  return new Response(JSON.stringify({ error: "Too many requests. Wait a minute and try again." }), {
    status: 429,
    headers: { "content-type": "application/json; charset=utf-8", "retry-after": "60", "cache-control": "no-store" },
  });
}

export default {
  async fetch(request: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response> {
    if (new URL(request.url).pathname === "/" && request.method === "GET") return new Response(renderLandingPage(), { headers: LANDING_HEADERS });
    const limited = await rateLimited(request, env);
    if (limited) return limited;
    if (env.DB) await ensureSchema(env.DB);
    const services = servicesForEnv(env);
    return createApp(env, services).fetch(request);
  },

  async scheduled(_event: ScheduledEvent, env: AppEnv, ctx: ExecutionContext): Promise<void> {
    if (env.DB) await ensureSchema(env.DB);
    ctx.waitUntil(expireDue(servicesForEnv(env)));
  },
};
