# M29 — Task world model acceptance

## Goal

Keep the user's actual goal, current reported/observed state, intended next action, expected evidence, constraints, and uncertainties coherent across multi-turn visual tasks without falsely claiming completion.

## Implementation

- Added a compact session-local task world model to the Co-Pilot client and `task_world_state` tool contract.
- Preserve the active goal, one next action, expected observable evidence, constraints, uncertainties, result source, and a bounded six-event history. If the goal changes, reset task-specific outcome continuity.
- Distinguish a user report of success/failure/uncertainty from the M27 guarded visual-verification result. The model's textual state update alone cannot mark visual success.
- Return the summarized state and a small set of fresh scene candidates to the model through the existing tool response. It is browser-session continuity, not durable storage or a semantic/world-anchored scene graph.

## Synthetic acceptance — CI passed; active Worker bundle content verified

- [x] Goals, state, intended action, expected evidence, constraints, and uncertainty are retained and summarized.
- [x] User-reported completion is distinct from guarded visual verification.
- [x] Only an M27 supported result can populate a visually-supported outcome.
- [x] Goal changes reset old task-specific result continuity.
- [x] History is bounded and state text is sanitized.
- [x] Public and embedded client assets match; TypeScript, client syntax, Worker dry-run, and the M29/M30 bundle-contract checks passed in [release validation run 38237325186](https://github.com/ashini-x/askmoina-voice/actions/runs/38237325186): 37 test files and 227 tests.
- [x] Active Cloudflare Worker deployment `3ada4cfb-cef8-455f-964e-332aa992d813` is serving 100% of traffic; the deployed script content includes the M29 task-state schema, create/merge helpers, and world-model summary helper.

## Real-model and real-device acceptance — still required

Test a multi-step task (e.g. align two books, then switch to a different setup task). Interrupt the plan after the first action and report that it failed. Pass if Moina keeps the original goal and failed check when relevant, revises the next action after contradictory evidence, and does not transfer completion from the old goal to the new one.
