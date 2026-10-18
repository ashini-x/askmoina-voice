# M5 — Intelligent contextual retrieval

**Implementation status:** Query-aware D1 retrieval, server-side Live tool wiring, privacy-safe timing/count telemetry, and a synthetic priority-baseline comparison suite are implemented.  
**Acceptance status:** Repository validation pending; retrieval-quality results are synthetic fixtures only.  
**Production data status:** The current M2 reference table contains 12 disabled draft entries and zero eligible approved rows. The deployed tool should therefore return no match until the separate rights and native-review gate is completed.

## Runtime design

M5 changes the reference path from loading every approved conversational example during session setup to retrieving relevant examples only when Live requests them for a phrasing/register task.

- Read only from assamese_conversation_reference_eligible, the view requiring enabled entries, cleared rights, native verification, and at least two distinct approving native-speaker reviewers.
- Bound a call to 100 D1 candidates, 180 characters of query text, and at most three examples with a 2,600-character result ceiling.
- Rank candidates deterministically using weighted token overlap from user examples, interaction intent, context summary, and notes. Ties are resolved by reviewer-set priority and entry ID.
- Preserve source title, URL, and license metadata with each match. Examples are treated as data, not instructions.
- Return an explicit no-match result when nothing fits. Missing D1 schema or query failures fail open, so contextual retrieval cannot prevent an otherwise healthy session from working.
- Log only outcome, candidate/result counts, query length, and elapsed time. The raw query, prompt, example text, and personal content are not included in the M5 telemetry line.
- Keep standard voice and Co-Pilot on the same server-side retrieval implementation.

This is intentionally a transparent lexical baseline, **not** an embeddings or vector-search system. M5 does not add a vector database or external embedding dependency.

## Retrieval benchmark

The file docs/benchmarks/assamese-retrieval-v1.json contains nine synthetic queries and candidate records. It compares the top-three recall of query-aware ranking to the existing priority-only baseline. Its target is at least 80% top-three recall and at least 25 percentage points of improvement over priority ordering.

The fixture benchmark is repeatable and useful for regression checks, but it does not prove natural Assamese response quality, performance on a real native-reviewed reference corpus, or semantic equivalence. Once eligible native-reviewed records exist, measure the actual corpus and production latency before considering embeddings. Only introduce a semantic/vector layer if it materially improves retrieval quality over this baseline without violating the session latency budget.

## Privacy and review constraints

- Existing M2 seed entries remain disabled until licensing/permission basis and at least two independent native-speaker approvals are complete.
- Never enable synthetic benchmark fixtures or treat their approved fields as production review.
- Retrieval scores decide which eligible example may be shown to the model; they do not certify that the response is linguistically correct or appropriate for every Upper Assam speaker.
- Human acceptance requires native listeners to review actual generated speech separately from this code benchmark.

## Verification and known unrelated failures

M5 should pass TypeScript, full test suite, benchmark validation, D1 migration checks, and Wrangler dry-run before merge. Production deployment, health, and live synthetic outcomes must then be inspected separately.

M4's deployment/health checks passed, but its post-deploy live synthetic suite finished with failure: grounded web search closed the Live WebSocket, speech-first response timed out, and voice memory timed out. The ranked-list test passed in that run. M5 does not claim to fix those independent runtime issues.
