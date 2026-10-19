const FULL_STOCKFISH_WASM_URL = "https://cdn.jsdelivr.net/npm/stockfish@19.0.1/bin/stockfish-19-single.wasm";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin"
};

/**
 * Stream the pinned full Stockfish WASM binary through a same-origin URL.
 * Cloudflare Workers Static Assets limit individual files to 25 MiB, while
 * the full Stockfish neural-network binary is much larger. The Worker streams
 * the pinned upstream response without buffering the 90+ MiB body in memory.
 */
export async function serveStrongStockfishWasm(request: Request, fetchImpl: typeof fetch = fetch): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...NO_STORE_HEADERS, Allow: "GET, HEAD" }
    });
  }

  const forwardedHeaders = new Headers();
  for (const name of ["Range", "If-Range"]) {
    const value = request.headers.get(name);
    if (value) forwardedHeaders.set(name, value);
  }

  try {
    const upstream = await fetchImpl(FULL_STOCKFISH_WASM_URL, {
      method: request.method,
      headers: forwardedHeaders,
      redirect: "follow"
    });
    if (!upstream.ok && upstream.status !== 206) {
      return new Response(JSON.stringify({ error: "strong_stockfish_asset_unavailable" }), {
        status: 502,
        headers: NO_STORE_HEADERS
      });
    }

    const headers = new Headers({
      "Content-Type": "application/wasm",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin"
    });
    for (const name of ["Accept-Ranges", "Content-Range", "ETag", "Last-Modified"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    // HEAD should preserve the upstream entity size when it is provided.
    // For streamed GET responses, leave Content-Length unset rather than
    // asserting a length over a relayed response body.
    if (request.method === "HEAD") {
      const contentLength = upstream.headers.get("Content-Length");
      if (contentLength) headers.set("Content-Length", contentLength);
    }

    // Keep the upstream stream intact; do not call arrayBuffer() on this large
    // neural-network binary inside the Worker.
    return new Response(request.method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      headers
    });
  } catch {
    return new Response(JSON.stringify({ error: "strong_stockfish_asset_unavailable" }), {
      status: 502,
      headers: NO_STORE_HEADERS
    });
  }
}

export const STRONG_STOCKFISH_WASM_SOURCE = FULL_STOCKFISH_WASM_URL;
