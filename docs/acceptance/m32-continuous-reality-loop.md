# M32 — One continuous reality loop

## Scope
Coordinate the current observation source with voice, camera frames, local tracking, and immersive WebXR. Never silently treat a previous camera image as current after AR or background interruptions.

## Synthetic acceptance
- [x] A finite-state helper tracks session start, camera ready, voice ready, fresh frames, immersive AR handoff, camera resume, background/foreground, camera failure, and stop.
- [x] Immersive AR reports local XR pose/hit-test only and explicitly says that no new camera images reach the live model.
- [x] Tool-requested camera-dependent overlays and visual verification are withheld while AR is active, after tab visibility changes, or while awaiting the first resumed frame.
- [x] Camera-dependent overlays remain blocked until a fresh frame is sent after handoff or foreground return.
- [x] Local tracking and stale screen marks are stopped/hidden during an observation interruption.
- [x] The state summary is returned with tool results so the model cannot reasonably infer unseen progress from stale geometry.
- [x] Prompt/schema, JavaScript syntax, bundle contract, and regression tests are included in release validation.

## Limits and live acceptance still required
This state machine tracks evidence availability; it does not make WebXR camera pixels accessible to Gemini and does not guarantee browser/device lifecycle behaviour. Real phone testing is required for AR exit/resume, camera permission errors, page hide/show, and re-acquisition.
