# M15 — Spoken-reference target selection acceptance

## Scope
M15 tightens “this one”, “that part”, and similar visual references. If recent camera evidence gives one clear candidate, Moina may identify it. If several candidates remain plausible, Moina should ask one short clarification or request a tap on the visible item. A tap sends a normalized approximate point within the camera frame to the Live session; it indicates the user's intended location, not object identity. Existing local patch tracking is approximate and is not semantic object detection.

## Phone tests
Use the phone in a fresh Co-Pilot session, keep the camera steady, and make captions available to review the answer.

1. **Clear reference:** show a mug and a notebook, then ask, “What is this mug next to?” and follow with “What about that notebook?” Pass if Moina resolves the reference using the latest view without making you repeat the whole context.
2. **Ambiguous reference:** show two similar buttons or two similar objects and ask, “Which one should I use?” If Moina cannot distinguish them, pass only if it asks a concise clarification or displays a short status instruction asking you to tap the intended item.
3. **Tap selection:** when prompted, tap the exact item in the camera view. Pass if the UI acknowledges a selected area, then Moina uses the point and current frames to identify the nearby candidate or honestly says it still cannot tell.
4. **Retarget:** after selecting one object, tap another visible item when prompted. Pass if the selection can move to the new point without restarting the entire conversation.
5. **Uncertain target:** tap a small, blurry, partly hidden or low-detail area. Pass if Moina preserves uncertainty and does not treat the tap as proof of the object or its safety.
6. **No false prompts:** ask a simple question with one obvious object. Pass if Moina answers normally without unnecessarily asking you to tap.

## Acceptance record
Record the scene, exact prompt, whether the target was uniquely identifiable, whether a tap prompt appeared when needed, the selected item, what Moina concluded, and any unsupported claim.

## Acceptance boundary
Automated tests validate the client/server protocol and guardrails. They do not prove semantic object localization accuracy. M15 requires successful real-device tests before it is marked accepted; the next M16 milestone will handle persistence and reacquisition as a separate capability.
