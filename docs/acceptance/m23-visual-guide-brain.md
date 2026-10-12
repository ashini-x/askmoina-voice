# M23 — Visual-guide brain acceptance

## Goal

Moina should proactively decide whether an on-screen guide materially clarifies the next low-risk physical action. It should choose a small number of useful screen-space primitives from the latest camera evidence, without waiting for the user to say "draw it" or forcing a tap merely to show geometric reference guidance.

## Shipped in this milestone

- Expanded the live co-pilot system instruction with proactive guide-selection rules and common spatial examples.
- Updated the model tool description to make visual primitives a first-class way to help, not merely an optional extra.
- Added automated contract tests covering proactive choice, minimal primitives, tap-free geometry, ambiguous-target caution, stale-guide clearing, and false-success prevention.
- Recorded M24–M40 as the current strategic roadmap.

## Synthetic acceptance

The following are machine-checkable contract checks. They show that the deployed code contains the rules and can safely accept the guide vocabulary; they do not demonstrate that a generative live model will always follow the rules.

1. [x] TypeScript type-check passes (Release validation run 38221293632; `npm run check` passed).
2. [x] The full Vitest suite passes, including M22 primitive-contract and M23 decision-policy tests (30 files, 182 tests passed in run 38221293632).
3. [x] Browser script syntax and Wrangler dry-run checks pass in CI (run 38221293632).
4. [x] Production health endpoint responds successfully; production smoke test also confirmed voice status was `available`, Co-Pilot/Vault/assets returned expected responses, and unauthenticated admin routes were protected (run 38221293632, successful retry).
5. [x] The deployed Worker source bundle contains the M23 decision policy and updated tool description; synthetic bundle inspection confirmed proactive drawing, cup-alignment example, minimal primitive rule, tap-free geometric guides, stale-guide clearing, false-completion guard, and model-tool description.

## Real-device acceptance — still required

Use a phone with a clear camera view and ask for a physical low-risk arrangement task without requesting a drawing explicitly.

Suggested prompt: "Help me arrange these three cups in a straight line. Tell me one step at a time, and check what changes after I move one."

Pass only if Moina independently decides that a visual reference materially helps, draws a sensible approximate alignment line without asking for a tap, gives a simple first move, updates/clears a guide if the scene changes, and does not claim the cups are aligned without visible evidence. Fail if it never draws a useful line, guesses a misleading line, adds unnecessary graphics, or asks for a tap solely to display the reference line.

Repeat with a second low-risk task involving a clear placement area or direction arrow. Keep the camera steady for the initial geometry test; camera transforms and world tracking are separate M24–M26 acceptance areas.

## Limitations

M23 is a prompting/tool-contract improvement, not a new computer-vision model. It does not by itself guarantee automatic detection, precise geometry, persistent target tracking, world-locked AR, autonomous task completion, or reliable verification. Record outcomes honestly and use failure cases to shape M24–M27.
