# M24 — Trustworthy camera geometry acceptance

## Goal

A visual guide uses the same camera-frame coordinate system as the image Gemini receives, then projects that normalized geometry onto the visible camera stage correctly. Viewport crop, orientation, preview mirroring, and zoom changes must not leave an old guide looking authoritative after its source coordinates are stale.

## Implementation

- Centralized the normalized source-frame → `object-fit: cover` stage projection in a pure browser helper.
- Mirrored front-facing preview and mirrored guide x-coordinates together; inverted tap-to-source mapping and locally tracked marker projection so selection/tracking does not silently choose the opposite side.
- Re-rendered the normalized guide after stage resizes with `ResizeObserver` (window-resize fallback).
- Cleared camera-dependent overlays after zoom changes, intrinsic video size changes, tab hiding, and camera switches.
- Kept the digital zoom preview and model-bound frame on the same centered crop; native camera zoom remains a change to the camera stream itself.
- Added automated geometry tests for portrait and landscape cover crops, mirrored coordinates, layout changes, invalidation, and asset synchronization.

## Synthetic acceptance

- [x] Pure projection tests map points correctly through portrait and landscape `object-fit: cover` crops.
- [x] Mirrored x-coordinate test confirms horizontal symmetry while keeping y-coordinate and overlay sizing consistent.
- [x] Viewport-change test confirms the mapping is recomputed for new dimensions.
- [x] Regression assertions cover zoom/video-size/visibility invalidation, mirrored target taps, marker placement, and viewport redraw.
- [x] Public `copilot.js` is byte-for-byte equal to the Worker-embedded browser script and parses successfully.
- [ ] CI type-check, full test suite, public script syntax, and Wrangler dry-run pass.
- [ ] Production health smoke passes; deployed Worker bundle includes the M24 implementation.

## Real-device acceptance — still required

On a phone, start Co-Pilot and test with a distinctive object near one side of the frame.

1. Ask Moina for a geometric visual guide and verify the guide sits on the same visible camera location it describes.
2. Change from portrait to landscape or resize/rotate the screen; verify the guide recomputes rather than shifting to stale coordinates.
3. Change zoom with pinch or the zoom control; verify the old guide disappears until new evidence arrives.
4. Flip to the front camera, tap a clear textured target if target tracking is requested, and verify the highlight stays on the selected side.
5. Switch back to the rear camera and ensure no front-camera guide or marker remains visible.

Pass only if overlays remain aligned, stale camera-dependent guidance is cleared, and a target tap/marker does not jump to the opposite side. This milestone does not provide world-locked tracking or prove semantic target identity.
