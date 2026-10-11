# M17 — Minimal target overlays acceptance

## Scope
M17 reduces the size and visual weight of approximate target cues: thinner, smaller corner brackets, a tiny center point, a compact label, and a single-line instruction preview. The camera remains the primary surface. The cue is a screen-space hint, not a world-locked AR measurement or semantic object boundary.

## Phone acceptance
Open [AskMoina Co-Pilot](https://askmoina-voice.thenewtongs.workers.dev/copilot) on a phone, start a session, and ask Moina to highlight something visible.

1. **Camera-first view:** pass if the camera remains dominant and the cue does not cover a large part of the object or screen.
2. **Small target:** ask Moina to focus on a small detail such as a button, connector, or printed logo. Pass if the corners and tiny center point are visible without creating a large card over the target.
3. **Long instruction:** ask for a focus cue with an explanation. Pass if the label stays compact and the preview is limited to one line; the spoken response remains the place for the full explanation.
4. **Tracking:** tap the target and move the phone slowly. Pass if the compact cue remains legible while M16 tracking behavior continues to work.
5. **Small phone / corner placements:** repeat on a narrow phone viewport and with a target near an edge. Pass if the cue and label remain readable and the label does not dominate the scene.
6. **Clear and retarget:** clear the cue, then select another target. Pass if the overlay disappears and the next cue uses the same compact design.

## Automated coverage
Regression tests check the compact styling contract and verify that the Worker-embedded CSS remains byte-for-byte synchronized with the public stylesheet.

## Acceptance boundary
M17 changes cue presentation, not the underlying target detector or tracking accuracy. The center point and corner brackets do not prove object identity, physical dimensions, or world-locked placement. Phone acceptance is still required for layout and visual comfort.
