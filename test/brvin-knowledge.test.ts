import { describe, expect, it, vi } from "vitest";
import {
  retrieveAskMoinaBrvinEvidence,
} from "../src/brvin-knowledge";
import type {
  BrvinAuthorizedProject,
  BrvinProjectStatus,
  BrvinRetrievalData,
  BrvinV2RpcBinding,
} from "../src/brvin-connector";

const passage = {
  id: "fatman-page-200",
  bookId: "fatman-legacy-538",
  bookTitle: "Fatman 2nd Edition",
  pdfPage: 200,
  printedPage: "184",
  section: "Indian Constitution",
  text: "The distribution of powers separates legislative, executive and judicial functions.",
  score: 0.94,
};

const data: BrvinRetrievalData = {
  passages: [passage],
  searchedSources: 1,
  searchCount: 1,
};

function makeBinding(
  retrieve: BrvinV2RpcBinding["retrieveProjectContextV2"] = vi.fn(async () => ({ ok: true as const, data })),
): BrvinV2RpcBinding {
  const project: BrvinAuthorizedProject = {
    projectId: "fatman",
    slug: "fatman",
    name: "Fatman",
    description: "SSC knowledge",
    ready: true,
    authorizedSourceCount: 1,
  };
  const status: BrvinProjectStatus = {
    projectId: "fatman",
    ready: true,
    authorizedSourceCount: 1,
  };
  return {
    listAuthorizedProjectsV2: vi.fn(async () => ({ ok: true as const, data: [project] })),
    getProjectStatusV2: vi.fn(async () => ({ ok: true as const, data: status })),
    retrieveProjectContextV2: retrieve,
  };
}

function makeEnv(binding: BrvinV2RpcBinding | null = makeBinding()) {
  return {
    BRVIN_SERVICE: binding ?? undefined,
    BRVIN_DEFAULT_PROJECT_ID: "fatman",
    BRVIN_CONNECTOR_TIMEOUT_MS: "15000",
  };
}

describe("AskMoina BRVIN knowledge tool", () => {
  it("requires a signed-in account before calling the private binding", async () => {
    const retrieve = vi.fn(async () => ({ ok: true as const, data }));
    const result = await retrieveAskMoinaBrvinEvidence(
      makeEnv(makeBinding(retrieve)),
      null,
      { query: "explain separation of powers" },
    );

    expect(result).toContain("only to a signed-in AskMoina account");
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("uses only the configured Fatman project and returns book/PDF page citations", async () => {
    const retrieve = vi.fn(async () => ({ ok: true as const, data }));
    const result = await retrieveAskMoinaBrvinEvidence(
      makeEnv(makeBinding(retrieve)),
      "uid_test_account",
      { query: "  explain   separation of powers " },
    );

    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(retrieve).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "fatman",
      queries: ["explain separation of powers"],
    }));
    expect(result).toContain("Fatman 2nd Edition — PDF page 200 (printed page 184)");
    expect(result).toContain(passage.text);
  });

  it("supports exact physical PDF page requests without inventing semantic queries", async () => {
    const retrieve = vi.fn(async () => ({ ok: true as const, data }));
    await retrieveAskMoinaBrvinEvidence(
      makeEnv(makeBinding(retrieve)),
      "uid_test_account",
      { page_numbers: [200, 201] },
    );

    expect(retrieve).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "fatman",
      queries: [],
      pageNumbers: [200, 201],
    }));
  });

  it("rejects malformed and out-of-range page selectors before the RPC", async () => {
    const retrieve = vi.fn(async () => ({ ok: true as const, data }));
    const env = makeEnv(makeBinding(retrieve));
    const invalid: unknown[] = [
      {},
      { query: "x".repeat(2_001) },
      { query: "valid", page_numbers: [0] },
      { query: "valid", page_numbers: [1, 2, 3, 4] },
      { page_numbers: ["200"] },
      { query: "bad\u0000query" },
    ];

    for (const input of invalid) {
      const result = await retrieveAskMoinaBrvinEvidence(env, "uid_test_account", input);
      expect(result).toContain("request was invalid");
    }
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("does not invent an alternate project when the binding is missing", async () => {
    const result = await retrieveAskMoinaBrvinEvidence(
      makeEnv(null),
      "uid_test_account",
      { query: "explain separation of powers" },
    );

    expect(result).toContain("not connected in this environment");
  });

  it("tells Gemini not to guess when no matching passages are found", async () => {
    const noResults: BrvinRetrievalData = {
      passages: [],
      searchedSources: 1,
      searchCount: 1,
    };
    const retrieve = vi.fn(async () => ({ ok: true as const, data: noResults }));
    const result = await retrieveAskMoinaBrvinEvidence(
      makeEnv(makeBinding(retrieve)),
      "uid_test_account",
      { query: "unrelated niche subject" },
    );

    expect(result).toContain("No matching text passages");
    expect(result).toContain("Do not claim the book supports an answer");
  });

  it("does not turn an unavailable image-only page into a guessed text answer", async () => {
    const imageOnly: BrvinRetrievalData = {
      passages: [],
      pageImages: [{ mimeType: "image/jpeg", data: "aGVsbG8=", byteLength: 5 }],
      searchedSources: 1,
      searchCount: 1,
    };
    const retrieve = vi.fn(async () => ({ ok: true as const, data: imageOnly }));
    const result = await retrieveAskMoinaBrvinEvidence(
      makeEnv(makeBinding(retrieve)),
      "uid_test_account",
      { page_numbers: [200] },
    );

    expect(result).toContain("found the requested PDF page image");
    expect(result).toContain("cannot interpret that image yet");
  });

  it("preserves project-denial and quota failures without falling back to another project", async () => {
    const denied = vi.fn(async () => ({
      ok: false as const,
      code: "PROJECT_NOT_AUTHORIZED" as const,
      message: "Denied.",
      retryable: false,
    }));
    const deniedResult = await retrieveAskMoinaBrvinEvidence(
      makeEnv(makeBinding(denied)),
      "uid_test_account",
      { query: "explain separation of powers" },
    );
    expect(deniedResult).toContain("not currently authorised");

    const quota = vi.fn(async () => ({
      ok: false as const,
      code: "MONTHLY_LIMIT_REACHED" as const,
      message: "Quota reached.",
      retryable: false,
    }));
    const quotaResult = await retrieveAskMoinaBrvinEvidence(
      makeEnv(makeBinding(quota)),
      "uid_test_account",
      { query: "explain separation of powers" },
    );
    expect(quotaResult).toContain("monthly search allowance has been reached");
  });
});
