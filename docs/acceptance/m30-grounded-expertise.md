# M30 — Grounded expertise acceptance

## Goal

Retrieve model-relevant manuals, diagrams, safety/recall notices, and troubleshooting sources without applying a procedure to a neighbouring or unidentified product.

## Implementation

- Extended `search_current_web` with optional explicit device context: manufacturer, model ID, variant/revision, part number, and requested material.
- The grounding prompt prioritizes manufacturer documentation and asks the model to distinguish exact-model results, neighbouring-model information, and generic guidance.
- Source title/URL checks annotate whether the supplied identifiers appear in the returned title or URL, plus an explicitly heuristic manufacturer-name hostname hint. These checks do not verify page contents or domain ownership.
- When a model ID, variant, or part number was given but none of the returned source titles/URLs visibly contains all identifiers, the result adds a clear model-match warning. The model must not offer model-specific steps until applicability is established.
- Existing limits remain: at most two grounded searches per voice session, an 8-second gap between searches, a 12-second request timeout, and no search on ordinary turns unless useful.

## Synthetic acceptance — CI passed; active Worker bundle content verified

- [x] Device context is sanitized and bounded; unknown fields are ignored.
- [x] Source title/URL assessment detects matching model text without treating it as page-content verification.
- [x] A neighbouring/mismatched model and absent ID remain explicitly unverified.
- [x] Search tool schema, voice and camera Co-Pilot prompts, route handler, source annotation, and mismatch warning are covered by regression tests.
- [x] Existing per-session search/cooldown bounds stay in force; client/source assets remain valid.
- [x] TypeScript, client syntax, Worker dry-run, M29/M30 bundle contracts and all tests passed in [release validation run 38237325186](https://github.com/ashini-x/askmoina-voice/actions/runs/38237325186): 37 test files and 227 tests.
- [x] Active Cloudflare Worker deployment `3ada4cfb-cef8-455f-964e-332aa992d813` is serving 100% of traffic; the deployed script contains device-context normalization, source assessment, mismatch warning, and the camera Co-Pilot model-aware grounding instructions.

## Live-grounding and real-task acceptance — still required

Use a device with a clearly printed model label. Ask for its exact official manual or a labelled diagram, then ask one troubleshooting question tied to a specific revision. Pass only if the cited source applies to the exact model/version, the content is checked rather than inferred from the URL, and mismatched documents are rejected. The synthetic source-title/URL test is not proof of real search quality.
