import { createApp } from "./app";
import { expireDue, servicesForEnv } from "./lifecycle";
import { ensureSchema } from "./schema";
import type { AppEnv } from "./types";
import { renderLandingPage } from "./ui";

export default {
  async fetch(request: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response> {
    if (new URL(request.url).pathname === "/" && request.method === "GET") return new Response(renderLandingPage(), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    if (env.DB) await ensureSchema(env.DB);
    const services = servicesForEnv(env);
    return createApp(env, services).fetch(request);
  },

  async scheduled(_event: ScheduledEvent, env: AppEnv, ctx: ExecutionContext): Promise<void> {
    if (env.DB) await ensureSchema(env.DB);
    ctx.waitUntil(expireDue(servicesForEnv(env)));
  },
};
