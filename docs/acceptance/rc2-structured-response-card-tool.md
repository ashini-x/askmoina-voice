# RC2 — Structured live response-card tool

Status: **Implementation candidate; deployment and live synthetic evidence pending.** This milestone defines a model-to-client contract only. It does not ship a visible response-card tray; that belongs to RC3, and type-specific renderers belong to RC4.

## Contract

- Expose `display_response_card` as its own Gemini Live function alongside, and separate from, `display_screen_overlay`.
- Support exactly three layouts: `steps`, `key_details`, and `comparison`.
- Bound payloads to 8,000 serialized characters; limit steps to 2–5, details to 1–8, comparison options to 2–4, and each option's attributes to 1–8.
- Validate allowed fields, nested item shapes, type-specific field combinations, string sizes, and control characters. Reject unknown keys and layout mixing. Model values are plain text data, never markup or executable content.
- Keep normal voice mode unchanged. The response-card tool is present only in the explicit Co-Pilot tool set.
- Keep acknowledgements bounded and name-matched in the browser-to-Worker protocol. The RC2 client explicitly tells the model that rendering is not enabled yet; it must continue with spoken guidance and must not claim a card is visible.
- Do not extend the camera-overlay schema or route response-card data through spatial overlay logic.

## Checks

- Unit tests cover valid examples for all three card types and reject missing, oversized, mixed-layout, unknown, malformed, and unsupported values.
- Protocol tests verify response-card acknowledgements are accepted only in Co-Pilot mode and retain the correct function name.
- Asset parity checks keep the public Co-Pilot client and Worker-embedded JavaScript identical.
- A production synthetic check opens an authenticated Live Co-Pilot session, speaks an explicit low-risk checklist request, requires a real `display_response_card` call, verifies bounded payload shape, sends a public-protocol acknowledgement, and waits for the post-tool answer.
- Passing this test validates tool transport/schema behavior only. It does not prove visual rendering, selection quality across arbitrary prompts, safety acceptance, or real-device usability.
