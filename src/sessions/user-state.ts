import type { Env } from "../config/env";
export class UserState {
 constructor(private readonly state: DurableObjectState, private readonly env: Env) {}
 async fetch(request: Request): Promise<Response> {
  if (request.method !== "GET" || new URL(request.url).pathname !== "/health") return Response.json({error:"not_found"},{status:404});
  return Response.json({ok:true,component:"user-state",environment:this.env.ENVIRONMENT || "unknown"});
 }
}
