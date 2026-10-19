import { describe, expect, it, vi } from "vitest";
import { serveStrongStockfishWasm, STRONG_STOCKFISH_WASM_SOURCE } from "../src/chess/strong-engine-asset";

describe("full Stockfish WASM asset relay", () => {
  it("streams the pinned full engine binary through a same-origin WASM response", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(STRONG_STOCKFISH_WASM_SOURCE);
      return new Response(new Uint8Array([0, 97, 115, 109]), {
        status: 200,
        headers: {
          "Content-Type": "application/wasm",
          "ETag": "\"pinned-full-engine\"",
          "Content-Length": "4"
        }
      });
    });

    const response = await serveStrongStockfishWasm(
      new Request("https://askmoina.test/chess/stockfish-19-single.wasm"),
      fetchImpl as typeof fetch
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/wasm");
    expect(response.headers.get("Cache-Control")).toContain("immutable");
    expect(response.headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
    expect(response.headers.get("ETag")).toBe("\"pinned-full-engine\"");
    expect(response.headers.get("Content-Length")).toBeNull();
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([0, 97, 115, 109]);
  });

  it("supports HEAD without returning a binary body", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const response = await serveStrongStockfishWasm(
      new Request("https://askmoina.test/chess/stockfish-19-single.wasm", { method: "HEAD" }),
      fetchImpl as typeof fetch
    );
    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
    expect(fetchImpl).toHaveBeenCalledWith(STRONG_STOCKFISH_WASM_SOURCE, expect.objectContaining({ method: "HEAD" }));
  });

  it("forwards byte ranges for compatible CDN/cache clients", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("Range")).toBe("bytes=0-3");
      return new Response(new Uint8Array([0, 97, 115, 109]), {
        status: 206,
        headers: { "Content-Range": "bytes 0-3/90000000", "Accept-Ranges": "bytes" }
      });
    });
    const response = await serveStrongStockfishWasm(
      new Request("https://askmoina.test/chess/stockfish-19-single.wasm", {
        headers: { Range: "bytes=0-3" }
      }),
      fetchImpl as typeof fetch
    );
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 0-3/90000000");
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
  });

  it("returns a bounded no-store error if the pinned CDN is unavailable", async () => {
    const fetchImpl = vi.fn(async () => new Response("upstream error", { status: 503 }));
    const response = await serveStrongStockfishWasm(
      new Request("https://askmoina.test/chess/stockfish-19-single.wasm"),
      fetchImpl as typeof fetch
    );
    expect(response.status).toBe(502);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ error: "strong_stockfish_asset_unavailable" });
  });

  it("does not buffer or cache failed fetches as successful engine responses", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("CDN timeout"); });
    const response = await serveStrongStockfishWasm(
      new Request("https://askmoina.test/chess/stockfish-19-single.wasm"),
      fetchImpl as typeof fetch
    );
    expect(response.status).toBe(502);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("rejects methods other than GET and HEAD", async () => {
    const fetchImpl = vi.fn();
    const response = await serveStrongStockfishWasm(
      new Request("https://askmoina.test/chess/stockfish-19-single.wasm", { method: "POST" }),
      fetchImpl as typeof fetch
    );
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET, HEAD");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
