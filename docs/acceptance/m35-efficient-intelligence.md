# M35 — Efficient intelligence

## Scope and implementation

- The Co-Pilot computes a tiny local luminance-difference score from a 24×18 thumbnail. It is used only to suppress redundant image uploads on a stable idle view.
- Changed scenes send promptly. Stable idle views still send a frame at least every 2.4 seconds. Active task state, visual guides, target selection, local tracking, zoom, or a required fresh frame bypass suppression.
- A sampling exception fails open and sends the frame. The local score is not object recognition, a task-result check, or a substitute for the model.
- The Worker logs setup and first-audio latency, grounded search count, media frame/byte counts, and provider token metadata when a usage frame is supplied. Logs contain counters, not transcript or audio payloads.
- Optional LIVE_INPUT_USD_PER_MILLION_TOKENS and LIVE_OUTPUT_USD_PER_MILLION_TOKENS settings permit a cost estimate only from provider-reported prompt/response counts. Without both configured rates or both token counts, estimated cost stays null.

## Synthetic acceptance

- [x] Provider usage parsing is restricted to frames that explicitly include usage metadata and ignores ordinary audio payloads.
- [x] Cost estimation validates both token counts and both configured non-negative rates; missing inputs produce null, not a false zero.
- [x] Adaptive sampling suppresses only stable idle views before the 2.4-second heartbeat; changed views and fresh-evidence states pass.
- [x] TypeScript, client syntax, and release workflow bundle assertions cover M35.

## Live observation still required

Observe production logs over representative sessions to establish the actual presence/frequency of provider usage frames, latency percentiles, and media savings. Configure rates only after confirming exact provider pricing units. The estimate is not invoice-grade billing.
