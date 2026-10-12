# M31 — Safety and uncertainty engine

## Scope
Use consequence and reversibility to prevent unsafe confidence from becoming a physical instruction or persuasive screen-space overlay. The client applies deterministic hazard rules even when the model reports low risk, and displays an explicit safety pause for high/critical cases.

## Synthetic acceptance
- [x] Deterministic rules recognise representative immediate hazards (sparking/live mains, damaged lithium batteries, gas/pressure work, critical vehicle systems, hazardous chemical mixing, medicine dose changes).
- [x] High/critical risk, an explicitly required pause, or an irreversible-action assessment blocks visual guidance.
- [x] Model-reported low risk cannot downgrade a deterministic high-risk match.
- [x] Old screen-space/target overlays are cleared on a safety pause; a visible, text-only notice is shown.
- [x] The gate's consequence, reversibility, flags, and next action are sent back to the model through the tool response.
- [x] Ordinary reversible tasks remain eligible for guidance; common tool/heat actions carry proportionate caution without automatic hard blocking.
- [x] Prompt/schema and worker-bundle assertions are covered by regression tests and release validation.

## Limits and live acceptance still required
Keyword rules are conservative but not a complete hazard detector and cannot certify an instruction as safe. Synthetic checks do not exercise a live Gemini conversation, every wording/language, or physical injury outcomes. Test on a phone with carefully chosen harmless and safety-critical scenarios; never simulate real danger.
