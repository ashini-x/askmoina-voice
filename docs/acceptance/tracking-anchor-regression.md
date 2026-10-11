# Tracking-anchor regression acceptance

## Why this change exists
A model-generated highlight previously appeared at a rough screen region even when the user had not selected the object. A center-position cue could therefore remain on screen after the camera moved away from the named target, making it look tracked when it was not.

## Expected behavior
1. Start a fresh Co-Pilot session and ask, "Highlight the power button on this remote."
2. Before tapping, the target brackets must stay hidden. A compact prompt should ask you to tap the exact target.
3. Tap the actual button or a textured part of its edge. The marker may appear only after local tracking starts successfully.
4. Slowly move the camera. Pass if the marker follows the selected visual patch.
5. Move to a different scene where the target is absent. Pass if the stale marker fades/hides and does not remain falsely pinned at the old screen location.
6. If the selected point has insufficient texture or reacquisition cannot be confirmed, pass only if the marker remains hidden and the UI asks for a more trackable target or a new tap.

## Technical boundary
This patch improves screen-space patch tracking. It does not add a neural detector, semantic identity guarantee, object bounding boxes, or world-locked AR. It must never describe a guessed screen-region marker as a successfully tracked object.
