# M27 — Automatic visual verification acceptance

## Goal

Compare a task-relevant visible condition before and after an action, and classify it as supported success, supported failure/no change, or ambiguous without turning a model assertion into proof.

## Implementation

- Added an optional visual_verification tool payload with a stable scene candidate ID, a concise visible criterion, criterion status, observed-change category, evidence type, model-reported confidence, and consequence level.
- The client compares the report against a previous and current scene observation for the same ID and unchanged label, with fresh timestamps, increasing frame sequence, and one camera-view generation. Hidden, stale, renamed/conflicted, or cross-view targets stay ambiguous.
- Direct low-consequence reports require confidence of at least 0.82; moderate-consequence reports require at least 0.93. Inferred evidence never qualifies for an automatic status. High-consequence outcomes remain ambiguous until stronger independent confirmation is available.
- A supported success requires a direct report that the criterion was met after an observed change. Supported failure/no change requires direct evidence that the criterion remains unmet with no relevant change. Contradictory or uncertain reports remain ambiguous.
- A concise, caveated status is included in the tool response for the model's next turn. It explicitly remains a model-reported camera comparison, not independent sensor proof or hidden-state verification.

## Synthetic acceptance — pending release validation

- [ ] Matching target IDs/labels and fresh before/after frames allow a supported low-consequence success.
- [ ] A fresh, direct no-change report with the criterion still unmet yields supported failure/no change.
- [ ] Missing or stale baselines, view-generation changes, hidden targets, identity conflicts, inferred evidence, low confidence, and inconsistent reports remain ambiguous.
- [ ] A candidate observation newer than the declared before-frame cannot be used as its baseline.
- [ ] High-consequence outcomes remain ambiguous even at model-reported confidence 1.0.
- [ ] Worker schema/prompt contract, client syntax, embedded asset parity, and production smoke markers pass.
- [ ] CI and the deployed /copilot.js bundle are verified before marking synthetic acceptance complete.

## Real-model and real-device acceptance — still required

Use a low-risk scene such as moving a cup into a clearly visible outlined area. Establish a visible baseline, move the cup once, then ask Moina whether the stated placement condition is met. Pass only if it compares a fresh view of the same cup and accurately distinguishes a clear change from no change or uncertainty. Do not use visual verification as proof of internal repair, electrical safety, or a hidden condition.
