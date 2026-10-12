# M26 — Persistent spatial tracking acceptance

## Goal

Keep a locally selected image patch associated across camera movement and cautious reacquisition, without silently jumping to a lookalike or leaving a confident marker on a lost target.

## Implementation

- Added a local track record containing a stable per-selection ID, target hint, user-tap origin, last image point/frame sequence, camera-view generation, match confidence, evidence/miss counts, and reacquisition count.
- Tracking state is explicit: user-tap anchored, visible, reacquiring, reacquired, invalidated, or lost.
- The existing local template matcher remains the source of location evidence. Reacquisition requires the same distinctive patch to score highly in two consistent scans; the existing finite loss window hides and eventually removes a stale marker.
- A change to zoom, camera source, video-frame dimensions, page visibility, or WebXR camera ownership invalidates the track and the scene model.
- Track metadata explicitly states `semanticIdentityVerified=false` and `worldLocked=false`: this is local 2D image-patch tracking, not semantic identity tracking or a world-anchored 3D track.

## Synthetic acceptance

- [x] A local track record is created from a user-selected patch without claiming semantic identity or world lock.
- [x] Stable track ID, match confidence, miss/loss state, and confirmed reacquisition are covered by helper tests.
- [x] A camera-view generation change invalidates the track instead of reprojecting stale geometry.
- [x] Regression tests confirm two-scan reacquisition, stale-marker expiry, camera-view invalidation, and public/embedded asset synchronization.
- [x] TypeScript, client syntax, and all tests passed in [Release validation run 38230026015](https://github.com/ashini-x/askmoina-voice/actions/runs/38230026015): 33 test files and 203 tests.
- [x] Production smoke inspected the live `/copilot.js` response and confirmed the M26 track helpers and invalidation paths were deployed.
- [ ] Real-world target continuity and lookalike rejection still require phone testing. The separate live-model integration steps were skipped; these checks are not inferred from unit tests.

## Real-device acceptance — still required

On a phone, start Co-Pilot, tap a distinctive textured feature on an object, then slowly move the phone and briefly move the feature behind your hand.

Pass if the cue follows the same patch when evidence is strong, becomes uncertain and fades/hides when the target is lost, and returns only after stable reacquisition of that same patch. If there are two similar buttons, deliberately move past both and check that the marker does not jump to the lookalike. If the feature cannot be reacquired, the correct result is to remove the old marker and ask you to tap again.

This test does not prove world locking. For world-anchored behavior, test the separate Spatial AR route on a supported device.
