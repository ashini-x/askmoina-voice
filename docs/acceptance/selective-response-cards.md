# RC1 — Selective response-card policy

Status: **Policy proposed; awaiting product-owner acceptance.** This document defines expected presentation behaviour before response-card implementation begins. RC1–RC8 are a separate work track and do not replace or renumber M1–M40.

## Purpose

AskMoina has three distinct ways to help:

- **Voice:** the natural, conversational explanation and the next useful thing to say.
- **Response card:** durable, scannable information worth keeping on screen while the user acts, compares, or checks exact details.
- **Camera guide:** a pointer, line, outline, or other bounded visual overlay when spatial placement or direction materially helps.

These are complementary, not interchangeable. Captions are not response cards, and response cards must not be implemented by extending the camera-overlay tool.

## Decision rule

Show a response card only when it serves a specific user goal that is materially harder to complete from speech alone. In particular, a card is usually justified when at least one of these is true:

1. **The user must carry out or track multiple actions.** Keep the current step prominent and make the remaining plan available without overwhelming the camera.
2. **Exact details must be inspected or copied.** Preserve settings, values, units, dates, conditions, part/model identifiers, or other reference details without requiring the user to remember them from audio.
3. **The user needs to compare options.** Align comparable attributes and state a concise takeaway when the evidence supports one.
4. **A compact checklist or structured summary is explicitly requested** or clearly improves successful task completion.
5. **A concise, non-procedural safety warning must remain visible** during an immediate hazard.

A card must **not** appear merely because an answer is long, because the model has facts to display, or because a tool is available. Prefer voice-only for brief conversational turns and simple answers. When in doubt, answer naturally first and ask a material clarifying question rather than showing a speculative card.

Voice remains the primary conversational channel. When voice and a card are both used, speech should briefly orient the user and explain the immediate next action; the card should preserve the structured details. Do not read every cell, field, or step aloud by default.

## Presentation outcomes

- **Speak only:** normal conversation, brief answers, or explanations where a card adds no practical value.
- **Speak + card:** the common pattern for step-by-step work, exact reference details, and comparisons.
- **Speak + warning card:** an immediate safety issue, with clear stop/withdraw guidance and no hazardous procedure.
- **Ask before carding:** the intended options, device/model, goal, or other material context is unclear.
- **Clear or replace the card:** the user changes tasks, the displayed information becomes irrelevant, or a correction changes the plan. For a continuing task, update its existing card instead of stacking duplicate cards.

Camera overlays remain separate. Add a camera guide only when spatial guidance helps, and continue to apply the existing safety, freshness, and visual-evidence rules. A response card can remain useful while camera evidence is unavailable, but it must never imply that an object, position, or action was just observed or verified unless the current evidence supports that claim.

## Acceptance examples

| User request / situation | Expected speech | Response card | Reason |
|---|---|---|---|
| “How are you?” | Natural conversation | No | A card adds friction, not value. |
| “What is 15 × 12?” | “180.” | Usually no | One short answer is easier to hear than to scan. |
| “What is the capital of Assam?” | Give the factual answer | No | A simple fact does not need a persistent panel. |
| “Explain photosynthesis.” | Teach conversationally with an example | Usually no | Length alone is not a reason to card. Add a visual/summary only if requested or materially helpful. |
| “Help me set up this device.” | Explain the immediate next action; ask about the model if it matters | Yes, when a multi-step plan or exact settings are known | A user may need to look back while performing the setup. |
| “Give me the full procedure.” | Briefly introduce the plan and guide the user | Yes — compact steps card, expandable for the full list | The sequence must remain available while the user works. |
| “What exact settings should I enter?” | Explain where the settings apply | Yes — key-details card with labels, values, and units | Exact values should not depend on memory of spoken audio. |
| “Compare these two phones.” | State the main recommendation only when supported | Yes — comparison card | Side-by-side details are easier to scan than a spoken table. |
| “Which one should I buy?” with no options or needs established | Ask a focused clarification | No, not yet | A comparison without grounded candidates or criteria would be speculative. |
| “Show me how to connect this cable.” | Give one safe next action | Only if multiple steps or exact port details need to persist | A card is not mandatory for every physical task; the camera guide may be more useful for the spatial part. |
| “The screen is flickering. What should I check?” | Guide one check at a time | A compact steps card if there are multiple safe checks | Keep the active step clear without filling the camera view. |
| “The device is sparking!” | Immediately tell the user to move away and not touch or continue; advise appropriate emergency/professional help | Yes — concise warning card, no repair steps | Safety takes priority over troubleshooting. |
| User asks “Why?” during the current setup | Explain the reason conversationally | Keep/update the existing card only if its content needs to change | Follow-up conversation should not spawn duplicate cards. |
| User changes from device setup to “Help me find my keys.” | Acknowledge the switch and address the new goal | Clear the obsolete setup card | Old instructions must not remain as if still current. |
| Assistant is uncertain whether a part or setting is visible | Say what is uncertain and request a clearer view/detail when needed | Only show clearly labelled known details; do not card guesses as facts | Cards can look authoritative, so uncertainty must remain explicit. |
| User speaks in natural Assamese-English: “Printer tu Wi-Fi logot connect koribo, step-by-step kua.” | Reply naturally in the user's language mix | Steps card if a multi-step setup is appropriate | The same selection rule applies across languages; do not force textbook Assamese. |
| User asks a long open-ended question with no actionable or reference need | Summarize conversationally and clarify if needed | No, unless a structured artifact materially helps | Verbosity is not the selection signal. |

These examples define intended behaviour, not claims about current live-model performance.

## Card-type boundaries for the first release

- **steps:** a bounded sequence or checklist. Emphasize the current action; additional steps may be collapsed.
- **key_details:** labelled values and concise reference facts, including units and conditions when provided.
- **comparison:** aligned attributes for two or more grounded options, plus a brief takeaway where justified.

Do not add a fourth card type as an RC1 workaround. Complex code, rich diagrams, citations/reference libraries, and saved/persistent cards are out of scope for the first release.

## Safety, honesty, and accessibility requirements

- A card never overrides the existing deterministic safety gate or permits a disallowed procedural overlay.
- In an immediate-hazard case, prioritize a concise spoken warning and a visible warning card; do not include dangerous step-by-step instructions.
- Do not mark a task step complete solely because it appeared on screen. Progress requires user confirmation or adequate current evidence under existing verification rules.
- Do not claim camera observation or verification from stale or unavailable frames.
- Keep cards compact by default and expandable on demand; avoid obscuring the camera, primary call controls, or critical safety state.
- Use readable text, visible labels, keyboard-accessible controls, and semantic structure. Card content is data, never model-authored executable HTML.

## RC1 acceptance checklist

- [ ] The product owner accepts the selection rule and examples above.
- [ ] Quick greetings and single-answer factual prompts stay voice-only.
- [ ] Multi-step tasks show a useful steps card when retaining the plan materially helps.
- [ ] Exact values and comparisons are structured when the user needs to inspect them.
- [ ] A long answer alone does not trigger a card.
- [ ] Hazard prompts produce only an appropriate warning, not dangerous procedures.
- [ ] Task changes clear obsolete content; follow-ups do not create duplicate cards.
- [ ] Assamese-English prompts follow the same intent-based policy.
- [ ] Response-card policy remains separate from caption rendering and camera-overlay tools.

## Next steps after RC1 acceptance

RC2 can then define the bounded structured tool contract in the live session. RC3–RC4 can implement and render the card area and its three types. RC5–RC8 cover lifecycle coordination, safety/overlay integration, regressions, and live prompt evaluation. Passing RC1 means the policy is agreed; it does not mean any card feature has been implemented or deployed.
