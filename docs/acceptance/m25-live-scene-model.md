# M25 — Live scene model acceptance

## Goal

Maintain a small, evidence-tagged scene model across recent camera frames. Candidate labels and IDs, visible/not-visible reports, approximate regions, evidence type, model-reported confidence, and simple relations help preserve useful context without turning approximate screen hints into proof of object identity or exact geometry.

## Implementation

- Added optional `scene_observations` and `scene_relations` fields to the bounded Co-Pilot overlay tool contract.
- Store at most 8 short-lived candidate records and 12 relations in the browser session. Evidence carries the sent camera-frame sequence, source-frame timestamp, and current camera-view generation.
- Reject structured observations if the source frame is older than 5 seconds or predates a camera-view generation change.
- Retain recently observed candidates for up to 7 seconds, but label their age in the summary returned to the model.
- Detect candidate IDs reused with a different normalized label and preserve the earlier record while marking the new identity as uncertain instead of silently overwriting it.
- Include evidence tags and model-reported confidence in a compact tool response summary; explicitly state this is not detection, measured geometry, or calibrated probability.

## Synthetic acceptance

CI is pending for this branch. Tests cover:
- fresh frame-tagged observations, evidence tags, confidence, regions, visibility, and relations;
- stale-frame and previous-camera-generation rejection;
- short retention and expiry;
- reused-ID / changed-label uncertainty rather than silent identity merge;
- bounded record count and Worker tool/prompt contract;
- public/embedded asset synchronization and JavaScript syntax.

## Real-device acceptance — still required

On a phone, use the rear camera with three distinct objects. Ask:

> Look at these three objects and help me place the blue cup to the left of the white cup. Give one step at a time and use a compact camera cue. Keep the identities separate only while the visible evidence supports it.

Then move one object, briefly occlude one, or change the viewpoint. Ask a follow-up about which object should move next.

Pass only if answers use current evidence, preserve distinct candidates when possible, and acknowledge ambiguity when identities/relations cannot be followed. Fail if the assistant silently swaps similar objects or treats an approximate region as exact. This test does not prove general semantic detection accuracy.
