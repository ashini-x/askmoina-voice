import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../workers/brvin-test-client/src/index";
import type {
  BrvinAuthorizedProject,
  BrvinPassage,
  BrvinV2RpcBinding,
} from "../src/brvin-connector/index";

const PROJECT: BrvinAuthorizedProject = {
  projectId: "project-a",
  slug: "project-a",
  name: "Project A",
  description: "Test knowledge workspace",
  ready: true,
  authorizedSourceCount: 1,
};

const PASSAGE: BrvinPassage = {
  id: "passage-1",
  bookId: "book-1",
  bookTitle: "Fatman Reference Book",
  pdfPage: 14,
  printedPage: "12",
  section: "Chapter 2",
  text: "This is the grounded passage returned by BRVIN.",
  score: 0.91,
};

function binding(overrides: Partial<BrvinV2RpcBinding> = {}): BrvinV2RpcBinding {
  return {
    listAuthorizedProjectsV2: vi.fn().mockResolvedValue({ ok: true, data: [PROJECT] }),
    getProjectStatusV2: vi.fn().mockResolvedValue({
      ok: true,
      data: { projectId: PROJECT.projectId, ready: true, authorizedSourceCount: 1 },
    }),
    retrieveProjectContextV2: vi.fn().mockResolvedValue({
      ok: true,
      data: { passages: [PASSAGE], searchedSources: 1, searchCount: 1 },
    }),
    ...overrides,
  };
}

function env(service?: BrvinV2RpcBinding, token = "test-only-secret") {
  return {
    BRVIN_SERVICE: service,
    BRVIN_TEST_ACCESS_TOKEN: token,
  };
}

function apiRequest(path: string, options: RequestInit = {}, token = "test-only-secret"): Request {
  return new Request("https://brvin-test-client.example" + path, {
    ...options,
    headers: {
      authorization: "Bearer " + token,
      ...(options.headers ?? {}),
    },
  });
}

describe("BRVIN test-client Worker", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("serves an isolated, no-store text test interface", async () => {
    const response = await worker.fetch(
      new Request("https://brvin-test-client.example/"),
      env(),
    );
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(html).toContain("BRVIN Test Lab");
    expect(html).toContain("Retrieve evidence");
    expect(html).not.toContain("BRVIN_SERVICE");
  });

  it("requires a tester token on every API route", async () => {
    const response = await worker.fetch(
      new Request("https://brvin-test-client.example/api/projects"),
      env(binding()),
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "UNAUTHORIZED" },
    });
  });

  it("fails closed when the tester token is not configured", async () => {
    const response = await worker.fetch(
      apiRequest("/api/health"),
      env(binding(), ""),
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "TEST_ACCESS_NOT_CONFIGURED" },
    });
  });

  it("reports an unconnected state without trying a public retrieval fallback", async () => {
    const response = await worker.fetch(apiRequest("/api/health"), env());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      connected: false,
      state: "not_connected",
    });
  });

  it("returns only projects provided by the trusted BRVIN application identity", async () => {
    const service = binding();
    const response = await worker.fetch(apiRequest("/api/projects"), env(service));
    const body = await response.json() as { projects: Array<{ projectId: string }> };
    expect(response.status).toBe(200);
    expect(body.projects.map((project) => project.projectId)).toEqual(["project-a"]);
    expect(service.listAuthorizedProjectsV2).toHaveBeenCalledOnce();
  });

  it("does not retrieve for a project outside the live authorised-project list", async () => {
    const service = binding();
    const response = await worker.fetch(
      apiRequest("/api/query", {
        method: "POST",
        body: JSON.stringify({ projectId: "project-b", query: "test" }),
      }),
      env(service),
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "PROJECT_NOT_AUTHORIZED" },
    });
    expect(service.retrieveProjectContextV2).not.toHaveBeenCalled();
  });

  it("returns physical page citations and retrieved passages for an authorised project", async () => {
    const service = binding();
    const response = await worker.fetch(
      apiRequest("/api/query", {
        method: "POST",
        body: JSON.stringify({ projectId: "project-a", query: "What does the reference say?" }),
      }),
      env(service),
    );
    const body = await response.json() as {
      ok: boolean;
      requestId: string;
      passages: Array<{ citation: string; pdfPage: number }>;
      evidenceText: string;
      searchedSources: number;
    };
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.requestId).toBeTruthy();
    expect(body.passages[0].pdfPage).toBe(14);
    expect(body.passages[0].citation).toContain("PDF page 14");
    expect(body.evidenceText).toContain("Fatman Reference Book — PDF page 14");
    expect(body.searchedSources).toBe(1);
    expect(service.getProjectStatusV2).toHaveBeenCalledWith({ projectId: "project-a" });
    expect(service.retrieveProjectContextV2).toHaveBeenCalledOnce();
  });

  it("supports exact-page retrieval without requiring a text query", async () => {
    const service = binding();
    const response = await worker.fetch(
      apiRequest("/api/query", {
        method: "POST",
        body: JSON.stringify({ projectId: "project-a", pageNumber: 14 }),
      }),
      env(service),
    );
    expect(response.status).toBe(200);
    expect(service.retrieveProjectContextV2).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project-a", queries: [], pageNumbers: [14] }),
    );
  });

  it("returns not-ready without attempting retrieval", async () => {
    const service = binding({
      getProjectStatusV2: vi.fn().mockResolvedValue({
        ok: true,
        data: { projectId: "project-a", ready: false, authorizedSourceCount: 0 },
      }),
    });
    const response = await worker.fetch(
      apiRequest("/api/query", {
        method: "POST",
        body: JSON.stringify({ projectId: "project-a", query: "test" }),
      }),
      env(service),
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "PROJECT_NOT_READY" },
    });
    expect(service.retrieveProjectContextV2).not.toHaveBeenCalled();
  });

  it("rejects cross-origin API requests", async () => {
    const response = await worker.fetch(
      new Request("https://brvin-test-client.example/api/health", {
        headers: {
          authorization: "Bearer test-only-secret",
          origin: "https://evil.example",
        },
      }),
      env(binding()),
    );
    expect(response.status).toBe(403);
  });

  it("returns the next-step message when the Service Binding is absent", async () => {
    const response = await worker.fetch(apiRequest("/api/projects"), env());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "BRVIN_NOT_CONNECTED" },
    });
  });
});
