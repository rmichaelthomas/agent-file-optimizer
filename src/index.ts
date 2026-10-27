import { createApp } from "./app";
import { expireDue, servicesForEnv } from "./lifecycle";
import type { AppEnv } from "./types";
import { renderLandingPage } from "./ui";

export default {
  async fetch(request: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response> {
    const services = servicesForEnv(env);
    if (new URL(request.url).pathname === "/" && request.method === "GET") return new Response(renderLandingPage(), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    return createApp(env, services).fetch(request);
  },

  async scheduled(_event: ScheduledEvent, env: AppEnv, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(expireDue(servicesForEnv(env)));
  },
};
