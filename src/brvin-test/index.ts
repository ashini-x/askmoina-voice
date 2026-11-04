import {
  createBrvinConnector,
  formatBrvinCitation,
  type BrvinV2RpcBinding,
} from "../brvin-connector";

export interface BrvinTextTestEnv {
  /**
   * Added only after M5 has registered this test application/environment and
   * M6 has configured its trusted Service Binding props.
   */
  BRVIN_SERVICE?: BrvinV2RpcBinding;
}

type ApiFailureCode =
  | "BRVIN_NOT_CONNECTED"
  | "ORIGIN_REJECTED"
  | "INVALID_REQUEST"
  | "PROJECT_NOT_AUTHORIZED"
  | "PROJECT_NOT_READY"
  | "APPLICATION_NOT_REGISTERED"
  | "APPLICATION_INACTIVE"
  | "ENVIRONMENT_NOT_REGISTERED"
  | "ENVIRONMENT_INACTIVE"
  | "PROJECT_INACTIVE"
  | "MONTHLY_LIMIT_REACHED"
  | "RETRIEVAL_FAILED"
  | "BRVIN_UNAVAILABLE";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}

function failure(
  code: ApiFailureCode,
  message: string,
  status: number,
  requestId?: string,
): Response {
  return json(
    {
      ok: false,
      error: { code, message, ...(requestId ? { requestId } : {}) },
    },
    status,
  );
}

function publicFailure(
  result: { ok: false; code: string; requestId?: string },
): Response {
  const messages: Record<string, string> = {
    INVALID_REQUEST: "Check the text query and physical PDF page number.",
    APPLICATION_NOT_REGISTERED: "This test Worker has not been registered with BRVIN.",
    APPLICATION_INACTIVE: "The test application is inactive in BRVIN.",
    ENVIRONMENT_NOT_REGISTERED: "This Worker environment is not registered with BRVIN yet.",
    ENVIRONMENT_INACTIVE: "This Worker environment is disabled or revoked.",
    PROJECT_NOT_AUTHORIZED: "That project is not available to this test application.",
    PROJECT_INACTIVE: "That project is inactive.",
    MONTHLY_LIMIT_REACHED: "The project's BRVIN query allowance has been reached.",
    RETRIEVAL_FAILED: "BRVIN could not complete the evidence lookup.",
    BRVIN_UNAVAILABLE: "BRVIN is unavailable. The request was not automatically repeated.",
  };
  const status: Record<string, number> = {
    INVALID_REQUEST: 400,
    APPLICATION_NOT_REGISTERED: 503,
    APPLICATION_INACTIVE: 403,
    ENVIRONMENT_NOT_REGISTERED: 503,
    ENVIRONMENT_INACTIVE: 403,
    PROJECT_NOT_AUTHORIZED: 403,
    PROJECT_INACTIVE: 409,
    MONTHLY_LIMIT_REACHED: 429,
    RETRIEVAL_FAILED: 502,
    BRVIN_UNAVAILABLE: 503,
  };
  const code = result.code in messages ? result.code : "BRVIN_UNAVAILABLE";
  return failure(
    code as ApiFailureCode,
    messages[code],
    status[code] ?? 503,
    result.requestId,
  );
}

function sameOrigin(request: Request, url: URL): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === url.origin;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function connector(env: BrvinTextTestEnv) {
  if (!env.BRVIN_SERVICE) return null;
  return createBrvinConnector(env.BRVIN_SERVICE, {
    timeoutMs: 15_000,
    maxResponseBytes: 8 * 1024 * 1024,
    onDiagnostic(event) {
      // Deliberately content-free: never log queries, passage text or user input.
      console.info("brvin_text_test_rpc", event);
    },
  });
}

export async function handleBrvinTextTestRequest(
  request: Request,
  env: BrvinTextTestEnv,
): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/api/health") {
    if (request.method !== "GET") {
      return failure("INVALID_REQUEST", "Use GET for this endpoint.", 405);
    }
    return json({
      ok: true,
      service: "brvin-text-test",
      connected: Boolean(env.BRVIN_SERVICE),
    });
  }

  if (url.pathname === "/api/projects") {
    if (request.method !== "GET") {
      return failure("INVALID_REQUEST", "Use GET for this endpoint.", 405);
    }
    const brvin = connector(env);
    if (!brvin) {
      return failure(
        "BRVIN_NOT_CONNECTED",
        "The test Worker is built but not connected. Register its BRVIN application environment through the admin workflow, then add the trusted Service Binding.",
        503,
      );
    }
    const result = await brvin.listAuthorizedProjects();
    if (!result.ok) return publicFailure(result);
    return json({
      ok: true,
      projects: result.data.map((project) => ({
        projectId: project.projectId,
        slug: project.slug,
        name: project.name,
        description: project.description,
        ready: project.ready,
        authorizedSourceCount: project.authorizedSourceCount,
      })),
    });
  }

  if (url.pathname === "/api/retrieve") {
    if (request.method !== "POST") {
      return failure("INVALID_REQUEST", "Use POST for this endpoint.", 405);
    }
    if (!sameOrigin(request, url)) {
      return failure("ORIGIN_REJECTED", "This test interface accepts same-origin requests only.", 403);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return failure("INVALID_REQUEST", "The request body must be valid JSON.", 400);
    }
    if (!isRecord(body)) {
      return failure("INVALID_REQUEST", "The request body must be a JSON object.", 400);
    }

    const projectId = typeof body.projectId === "string" ? body.projectId : "";
    const query = typeof body.query === "string" ? body.query.replace(/\s+/gu, " ").trim() : "";
    const pageNumber = body.pageNumber;
    if (
      !projectId ||
      projectId.length > 128 ||
      projectId.trim() !== projectId ||
      projectId.includes("\u0000") ||
      query.length > 2_000 ||
      (pageNumber !== undefined &&
        (typeof pageNumber !== "number" ||
          !Number.isSafeInteger(pageNumber) ||
          pageNumber < 1 ||
          pageNumber > 100_000)) ||
      (!query && pageNumber === undefined)
    ) {
      return failure(
        "INVALID_REQUEST",
        "Choose an authorised project and enter a query, a physical PDF page number, or both.",
        400,
      );
    }

    const brvin = connector(env);
    if (!brvin) {
      return failure(
        "BRVIN_NOT_CONNECTED",
        "The test Worker is built but not connected to a registered BRVIN environment yet.",
        503,
      );
    }

    // Fresh discovery before retrieval prevents this UI from becoming a project
    // enumeration surface. BRVIN independently checks the grant again on retrieval.
    const authorized = await brvin.listAuthorizedProjects();
    if (!authorized.ok) return publicFailure(authorized);
    const project = authorized.data.find((item) => item.projectId === projectId);
    if (!project) {
      return failure(
        "PROJECT_NOT_AUTHORIZED",
        "That project is not in this application's current authorised project list.",
        403,
      );
    }
    if (!project.ready) {
      return failure(
        "PROJECT_NOT_READY",
        "This project is authorised but has no ready knowledge sources yet.",
        409,
      );
    }

    const requestId = crypto.randomUUID();
    const result = await brvin.retrieveProjectContext({
      projectId,
      queries: query ? [query] : [],
      pageNumbers: pageNumber === undefined ? [] : [pageNumber],
      requestId,
    });
    if (!result.ok) return publicFailure(result);

    return json({
      ok: true,
      requestId,
      project: { projectId: project.projectId, name: project.name },
      searchedSources: result.data.searchedSources,
      searchCount: result.data.searchCount,
      passages: result.data.passages.map((passage) => ({
        id: passage.id,
        bookTitle: passage.bookTitle,
        pdfPage: passage.pdfPage,
        printedPage: passage.printedPage,
        section: passage.section,
        score: passage.score,
        citation: formatBrvinCitation(passage),
        text: passage.text,
      })),
    });
  }

  return failure("INVALID_REQUEST", "Not found.", 404);
}

const worker = {
  fetch(request: Request, env: BrvinTextTestEnv): Promise<Response> {
    return handleBrvinTextTestRequest(request, env);
  },
};

export default worker;
