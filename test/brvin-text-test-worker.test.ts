import { describe, expect, it, vi } from "vitest";
import {
  handleBrvinTextTestRequest,
  type BrvinTextTestEnv,
} from "../src/brvin-test";
import type { BrvinV2RpcBinding } from "../src/brvin-connector";

const project = {
  projectId: "test-project-uuid",
  slug: "test-project",
  name: "Test Project",
  description: "Isolated test corpus",
  ready: true,
  authorizedSourceCount: 1,
};

const passage = {
  id: "passage-1",
  bookId: "book-1",
  bookTitle: "BRVIN Test Book",
  pdfPage: 14,
  printedPage: "12",
  section: "Architecture",
  text: "A test passage grounded in the indexed source.",
  score: 0.91,
};

function makeBinding(): {
  binding: BrvinV2RpcBinding;
  retrieve: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
} {
  const list = vi.fn(async () => ({
    ok: true as const,
    data: [project],
  }));
  const retrieve = vi.fn(async (_input: {
    projectId: string;
    queries: string[];
    pageNumbers?: number[];
    requestId?: string;
  }) => ({
    ok: true as const,
    data: {
      passages: [passage],
      searchedSources: 1,
      searchCount: 1,
    },
  }));
  const binding: BrvinV2RpcBinding = {
    listAuthorizedProjectsV2: list,
    getProjectStatusV2: async () => ({
      ok: true,
      data: {
        projectId: project.projectId,
        ready: true,
        authorizedSourceCount: 1,
      },
    }),
    retrieveProjectContextV2: retrieve,
  };
  return { binding, retrieve, list };
}

function request(
  path: string,
  method = "GET",
  body?: unknown,
  origin = "https://brvin-text-test.example",
): Request {
  return new Request("https://brvin-text-test.example" + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json", origin }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("BRVIN text test Worker", () => {
  it("lists only projects returned by the current trusted BRVIN identity", async () => {
    const { binding, list } = makeBinding();
    const response = await handleBrvinTextTestRequest(
      request("/api/projects"),
      { BRVIN_SERVICE: binding },
    );
    const data = await response.json() as { ok: boolean; projects: Array<{ projectId: string }> };

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.projects.map((item) => item.projectId)).toEqual(["test-project-uuid"]);
    expect(list).toHaveBeenCalledOnce();
  });

  it("retrieves evidence only after fresh project discovery and formats physical PDF citations", async () => {
    const { binding, list, retrieve } = makeBinding();
    const response = await handleBrvinTextTestRequest(
      request("/api/retrieve", "POST", {
        projectId: "test-project-uuid",
        query: "What is the architecture?",
        pageNumber: 14,
        applicationEnvironmentId: "attacker-controlled-value",
      }),
      { BRVIN_SERVICE: binding },
    );
    const data = await response.json() as {
      ok: boolean;
      passages: Array<{ citation: string; text: string }>;
    };

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(list).toHaveBeenCalledOnce();
    expect(retrieve).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "test-project-uuid",
      queries: ["What is the architecture?"],
      pageNumbers: [14],
    }));
    expect(data.passages[0].citation).toContain("BRVIN Test Book");
    expect(data.passages[0].citation).toContain("PDF page 14");
    expect(data.passages[0].text).toContain("grounded in the indexed source");
  });

  it("denies an unlisted project before calling retrieval", async () => {
    const { binding, retrieve } = makeBinding();
    const response = await handleBrvinTextTestRequest(
      request("/api/retrieve", "POST", {
        projectId: "another-apps-project",
        query: "Try to enumerate a project",
      }),
      { BRVIN_SERVICE: binding },
    );
    const data = await response.json() as { ok: boolean; error: { code: string } };

    expect(response.status).toBe(403);
    expect(data.error.code).toBe("PROJECT_NOT_AUTHORIZED");
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("uses exact-page retrieval without inventing a text query", async () => {
    const { binding, retrieve } = makeBinding();
    const response = await handleBrvinTextTestRequest(
      request("/api/retrieve", "POST", {
        projectId: "test-project-uuid",
        pageNumber: 14,
      }),
      { BRVIN_SERVICE: binding },
    );

    expect(response.status).toBe(200);
    expect(retrieve).toHaveBeenCalledWith(expect.objectContaining({
      queries: [],
      pageNumbers: [14],
    }));
  });

  it("does not call BRVIN when the project is authorised but not ready", async () => {
    const { binding, retrieve } = makeBinding();
    const notReadyBinding: BrvinV2RpcBinding = {
      ...binding,
      listAuthorizedProjectsV2: async () => ({
        ok: true,
        data: [{ ...project, ready: false, authorizedSourceCount: 0 }],
      }),
    };
    const response = await handleBrvinTextTestRequest(
      request("/api/retrieve", "POST", {
        projectId: "test-project-uuid",
        query: "A question",
      }),
      { BRVIN_SERVICE: notReadyBinding },
    );
    const data = await response.json() as { error: { code: string } };

    expect(response.status).toBe(409);
    expect(data.error.code).toBe("PROJECT_NOT_READY");
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("rejects cross-origin writes before consulting BRVIN", async () => {
    const { binding, list } = makeBinding();
    const response = await handleBrvinTextTestRequest(
      request("/api/retrieve", "POST", {
        projectId: "test-project-uuid",
        query: "A question",
      }, "https://untrusted.example"),
      { BRVIN_SERVICE: binding },
    );
    const data = await response.json() as { error: { code: string } };

    expect(response.status).toBe(403);
    expect(data.error.code).toBe("ORIGIN_REJECTED");
    expect(list).not.toHaveBeenCalled();
  });

  it("returns a clear not-connected state until M5/M6 provisions the binding", async () => {
    const response = await handleBrvinTextTestRequest(request("/api/projects"), {});
    const data = await response.json() as { ok: boolean; error: { code: string } };

    expect(response.status).toBe(503);
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("BRVIN_NOT_CONNECTED");
  });

  it("rejects malformed input without calling the service", async () => {
    const { binding, list } = makeBinding();
    const response = await handleBrvinTextTestRequest(
      request("/api/retrieve", "POST", {
        projectId: "test-project-uuid",
        query: " ",
      }),
      { BRVIN_SERVICE: binding },
    );
    const data = await response.json() as { error: { code: string } };

    expect(response.status).toBe(400);
    expect(data.error.code).toBe("INVALID_REQUEST");
    expect(list).not.toHaveBeenCalled();
  });
});
