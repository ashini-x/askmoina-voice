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

1. [ ] TypeScript type-check passes.
2. [ ] The full Vitest suite passes, including M22 primitive-contract and M23 decision-policy tests.
3. [ ] Browser script syntax and Wrangler dry-run checks pass in CI.
4. [ ] Production health endpoint responds successfully.
5. [ ] The deployed Worker source bundle contains the M23 decision policy and updated tool description.

## Real-device acceptance — still required

Use a phone with a clear camera view and ask for a physical low-risk arrangement task without requesting a drawing explicitly.

Suggested prompt: "Help me arrange these three cups in a straight line. Tell me one step at a time, and check what changes after I move one."

Pass only if Moina independently decides that a visual reference materially helps, draws a sensible approximate alignment line without asking for a tap, gives a simple first move, updates/clears a guide if the scene changes, and does not claim the cups are aligned without visible evidence. Fail if it never draws a useful line, guesses a misleading line, adds unnecessary graphics, or asks for a tap solely to display the reference line.

Repeat with a second low-risk task involving a clear placement area or direction arrow. Keep the camera steady for the initial geometry test; camera transforms and world tracking are separate M24–M26 acceptance areas.

## Limitations

M23 is a prompting/tool-contract improvement, not a new computer-vision model. It does not by itself guarantee automatic detection, precise geometry, persistent target tracking, world-locked AR, autonomous task completion, or reliable verification. Record outcomes honestly and use failure cases to shape M24–M27.
