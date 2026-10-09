import type { Env } from "./config/env";
export { UserState } from "./sessions/user-state";
export default {
 async fetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/api/health") return Response.json({ok:true,app:"askmoina-voice",version:env.APP_VERSION || "0.1.0",environment:env.ENVIRONMENT || "unknown",status:"foundation-only"},{headers:{"Cache-Control":"no-store"}});
  if (url.pathname.startsWith("/api/")) return Response.json({error:"not_implemented"},{status:404});
  return env.ASSETS.fetch(request);
 },
 async queue(batch: MessageBatch<unknown>): Promise<void> { for (const message of batch.messages) message.ack(); }
};
