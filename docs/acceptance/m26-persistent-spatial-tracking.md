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

CI is pending for this branch. Tests cover:
- explicit user-tap anchored track creation;
- stable track ID across a valid match, a miss, and a confirmed reacquisition;
- declining confidence during loss and invalidation on camera-view generation changes;
- two-scan reacquisition threshold, stale-marker expiry, camera-change invalidation, and public/embedded asset synchronization.

## Real-device acceptance — still required

On a phone, start Co-Pilot, tap a distinctive textured feature on an object, then slowly move the phone and briefly move the feature behind your hand.

Pass if the cue follows the same patch when evidence is strong, becomes uncertain and fades/hides when the target is lost, and returns only after stable reacquisition of that same patch. If there are two similar buttons, deliberately move past both and check that the marker does not jump to the lookalike. If the feature cannot be reacquired, the correct result is to remove the old marker and ask you to tap again.

This test does not prove world locking. For world-anchored behavior, test the separate Spatial AR route on a supported device.
