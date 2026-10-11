# M16 — Persistent visual tracking acceptance

## Scope
M16 improves the existing local image-patch tracker. It searches locally during normal movement, runs a wider whole-frame scan after losing confidence, fades the marker during recovery, hides the stale marker after about 1.3 seconds, and gives up after an eight-second recovery window. Reacquisition is approximate patch matching, not semantic object recognition or guaranteed identity tracking.

## Phone tests
Use a fresh Co-Pilot session. Select a textured, distinctive target such as a printed logo, a patterned mug, or a book corner by tapping it in the camera preview. A flat wall or plain surface is a poor tracking target.

1. **Slow camera movement:** keep the selected target visible and move the phone slowly left, right, up, and down. Pass if the marker follows the same visible image patch rather than remaining at its original screen position.
2. **Fast camera movement:** move the camera enough that the patch leaves the tracker's immediate search area, while keeping the target in the frame. Pass if the marker may briefly enter recovery mode but returns only when the wider scan finds a sufficiently strong match.
3. **Brief obstruction:** cover the selected target with your hand for around one second, then uncover it. Pass if the marker fades while confidence is lost and reappears near the same target when a strong match returns.
4. **Long obstruction / target out of view:** hide the target or point the camera elsewhere for longer than eight seconds. Pass if the old marker is hidden and the UI asks you to bring the target back into view and tap again, rather than leaving a stale marker visible.
5. **Similar textures:** select a patterned area near another similar-looking area, then move the camera or briefly occlude the target. Pass only if the marker does not confidently jump to the other object. If the scene makes the patch ambiguous, it is safer for the marker to remain hidden.
6. **Retarget:** after recovery or loss, tap a different textured object. Pass if tracking restarts cleanly without stale recovery state from the previous object.

## Acceptance record
Record the selected target, camera movement, obstruction duration, whether the marker faded, whether it reacquired the same patch, and any false jump. Repeat with at least two different targets.

## Acceptance boundary
Automated tests validate the recovery flow and asset synchronization. They do not prove robust tracking across every device, lighting condition, or occlusion. Local patch matching can follow image texture, not the semantic identity of an object. M16 needs real-device acceptance before it can be marked fully accepted.
