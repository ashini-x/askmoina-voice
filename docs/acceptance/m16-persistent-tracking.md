# M16 — Persistent visual tracking acceptance

## Scope
M16 improves the existing local image-patch tracker. A model-suggested target no longer appears at an arbitrary screen region: the user must tap the specific visible target before the marker is shown. The tracker uses a larger contextual patch, rejects nearly uniform image areas, applies stricter matching, and requires two consistent whole-frame scans before reacquisition. It fades and hides the marker during recovery and gives up after an eight-second recovery window. Reacquisition is approximate patch matching, not semantic object recognition or guaranteed identity tracking.

## Phone tests
Use a fresh Co-Pilot session. Ask Moina to highlight a specific object such as a remote's power button. Pass only if the UI asks you to tap the target before any highlight appears. Then tap a textured, distinctive part such as the button edge, printed logo, patterned mug, or book corner. A flat wall or plain surface is a poor tracking target.

1. **No guessed marker:** ask Moina to highlight an object without tapping it. Pass if no marker appears in the default center/region; instead the UI clearly asks you to tap the target.
2. **Slow camera movement:** after tapping a textured part, keep it visible and move the phone slowly left, right, up, and down. Pass if the marker follows the same visible image patch rather than remaining at its original screen position.
3. **Fast camera movement:** move the camera enough that the patch leaves the tracker's immediate search area, while keeping the target in the frame. Pass if the marker may briefly enter recovery mode but returns only when the wider scan finds a sufficiently strong match.
4. **Brief obstruction:** cover the selected target with your hand for around one second, then uncover it. Pass if the marker fades while confidence is lost and reappears near the same target when a strong match returns.
5. **Long obstruction / target out of view:** hide the target or point the camera elsewhere for longer than eight seconds. Pass if the old marker is hidden and the UI asks you to bring the target back into view and tap again, rather than leaving a stale marker visible.
6. **Similar textures:** select a patterned area near another similar-looking area, then move the camera or briefly occlude the target. Pass only if the marker does not confidently jump to the other object. If the scene makes the patch ambiguous, it is safer for the marker to remain hidden.
7. **Retarget:** after recovery or loss, tap a different textured object. Pass if tracking restarts cleanly without stale recovery state from the previous object.

## Acceptance record
Record the selected target, camera movement, obstruction duration, whether the marker faded, whether it reacquired the same patch, and any false jump. Repeat with at least two different targets.

## Acceptance boundary
Automated tests validate anchored-marker gating, low-texture rejection, recovery confirmation, and asset synchronization. They do not prove robust tracking across every device, lighting condition, or occlusion. Local patch matching can follow image texture, not the semantic identity of an object. M16 needs real-device acceptance before it can be marked fully accepted.
