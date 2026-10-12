# M28 — Generative spatial language acceptance

## Goal

Generate task-specific spatial guidance by composing a small set of reusable primitives, rather than relying on a separate hard-coded overlay for every task.

## Implementation

- Added semantic spatial_cues for alignment, motion path, placement region, target point, orientation, and point-attached label.
- A client normalizer converts cues into the existing bounded 2D SVG primitive language: lines, directional polylines, polygons, circles, arrows, and labels. Placement polygons receive only a light fill so the live camera remains visible.
- Normalization rejects unsupported cue kinds, out-of-frame coordinates, missing point data, underspecified geometry, and point lists longer than eight; at most five semantic cues and eight rendered primitives are accepted per tool call.
- The existing visual_elements interface remains compatible for older model responses. Generic geometric cues can render with visual_only=true without requesting a target tap.
- Coordinates remain approximate normalized screen-space guidance. They are not detected object boundaries, measurement, semantic object recognition, world-locked tracking, or automatic physical-placement confirmation.

## Synthetic acceptance — pending release validation

- [ ] Alignment, motion path, placement region, target point, orientation, and labels normalize to expected bounded primitives.
- [ ] Out-of-range, malformed, or underspecified geometry is rejected instead of being guessed.
- [ ] Cue and point-count limits are enforced; arrow direction and subtle region fill are present.
- [ ] The legacy visual_elements path remains compatible and embedded browser assets remain byte-identical to public assets.
- [ ] Worker schema/prompt contract, client syntax, and production smoke markers pass.
- [ ] CI and the deployed /copilot.js and /copilot.css assets are verified before marking synthetic acceptance complete.

## Real-device acceptance — still required

On a phone, ask for help aligning two objects or moving a safe household object into a clearly visible empty area. Check that the overlay is compact, the path/outline follows the proposed screen-space coordinates, and the camera scene remains visible. Move the phone and confirm the guide is not mistaken for a world-locked anchor. Real-model cue selection and physical usability remain unproven until tested.
