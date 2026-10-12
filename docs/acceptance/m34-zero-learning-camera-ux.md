# M34 — Zero-learning camera-first UX

## Goal

A first-time user should understand what to do without a tutorial, command syntax, or expert terminology. The live camera remains the primary surface and the normal path has one obvious Start action.

## Implementation

- Keep technical controls behind the existing More controls affordance.
- Use direct placeholder guidance before starting and a compact natural-language invitation with optional examples once the camera is ready.
- Explain the first action in the connected status line, using plain language rather than asking the user to select a task category or tap an object merely to begin.
- Keep the real camera and conversation primary; offer overlays only when they help with the current action.

## Synthetic acceptance

- [x] Browser-asset tests confirm the single Start path and hidden secondary controls.
- [x] Empty-state copy invites a goal in the user's own words and offers three short, optional examples.
- [x] Transcript reset restores the same invitation and examples as the initial page.
- [x] Connected status no longer requires the user to know about local target tracking.
- [x] CSS provides a compact, responsive example line; client script syntax and embedded asset parity are covered by tests.

## Real-device usability acceptance — still required

Ask a first-time user to open Co-Pilot on a phone without explaining the interface. Observe whether they can start, understand that they may speak naturally, and begin a task within a few seconds. Try a non-repair request (compare or explain), a request needing a visual cue, and an interruption. Pass only if they do not need a tutorial and the main camera remains unobstructed. Automated copy checks cannot establish usability.
