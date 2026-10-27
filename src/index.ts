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

export default {
  async fetch(request: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response> {
    if (new URL(request.url).pathname === "/" && request.method === "GET") return new Response(renderLandingPage(), { headers: LANDING_HEADERS });
    if (env.DB) await ensureSchema(env.DB);
    const services = servicesForEnv(env);
    return createApp(env, services).fetch(request);
  },

  async scheduled(_event: ScheduledEvent, env: AppEnv, ctx: ExecutionContext): Promise<void> {
    if (env.DB) await ensureSchema(env.DB);
    ctx.waitUntil(expireDue(servicesForEnv(env)));
  },
};
