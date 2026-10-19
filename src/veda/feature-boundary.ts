import type { Env } from "../config/env";

export const VEDA_APP_ROOT = "/veda";
export const VEDA_API_ROOT = "/api/veda";
export const VEDA_PHASE = "phase-1-isolation";

type VedaFeatureEnvironment = Pick<Env, "VEDA_ENABLED">;

export function isVedaRoutePath(pathname: string): boolean {
  return pathname === VEDA_APP_ROOT ||
    pathname.startsWith(`${VEDA_APP_ROOT}/`) ||
    pathname === VEDA_API_ROOT ||
    pathname.startsWith(`${VEDA_API_ROOT}/`);
}

export function isVedaApiPath(pathname: string): boolean {
  return pathname === VEDA_API_ROOT || pathname.startsWith(`${VEDA_API_ROOT}/`);
}

export function isVedaEnabled(env: VedaFeatureEnvironment): boolean {
  return env.VEDA_ENABLED?.trim().toLowerCase() === "true";
}

/**
 * Phase 1 reserves Veda routes without publishing a usable Veda app.
 * The feature is deliberately disabled in both production and preview config.
 * Any later enablement still requires the existing server-side admin check.
 */
export function handleVedaBoundaryRequest(
  request: Request,
  env: VedaFeatureEnvironment,
  adminAuthorized: boolean,
): Response | null {
  const url = new URL(request.url);
  const pathname = url.pathname;
  if (!isVedaRoutePath(pathname)) return null;

  if (!isVedaEnabled(env)) return notFound(pathname);

  if (!adminAuthorized) {
    if (isVedaApiPath(pathname)) {
      return jsonResponse({ error: "admin_required" }, 401);
    }
    if (request.method === "GET" || request.method === "HEAD") {
      return Response.redirect(new URL("/admin/login", request.url).toString(), 302);
    }
    return textResponse("Admin authentication required", 401);
  }

  if (pathname === `${VEDA_API_ROOT}/status`) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return jsonResponse({ error: "method_not_allowed" }, 405, { Allow: "GET, HEAD" });
    }
    return jsonResponse({
      ok: true,
      feature: "veda",
      phase: VEDA_PHASE,
      enabled: true,
      runtimeReady: false,
      message: "Veda is isolated, but its installation UI, device pairing, and Live runtime are not implemented in Phase 1.",
    }, 200, {}, request.method === "HEAD");
  }

  // No Veda UI or other API capabilities are published in Phase 1.
  return notFound(pathname);
}

function notFound(pathname: string): Response {
  if (isVedaApiPath(pathname)) return jsonResponse({ error: "not_found" }, 404);
  return textResponse("Not found", 404);
}

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  extraHeaders: Record<string, string> = {},
  headOnly = false,
): Response {
  return new Response(headOnly ? null : JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Cross-Origin-Resource-Policy": "same-origin",
      ...extraHeaders,
    },
  });
}

function textResponse(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
