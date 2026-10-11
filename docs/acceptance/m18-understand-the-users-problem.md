# M18 — Understand the user's problem acceptance

## Scope
M18 adds a quiet reasoning protocol before Moina selects advice: identify the desired outcome or reported symptom, relevant scene/context, facts versus hypotheses, the one missing detail that could change the next action, and the consequence if the guess is wrong. This should change the quality of the conversation, not add a checklist panel or make the user answer a questionnaire.

## Test on a phone
Open the production Co-Pilot in a fresh session: https://askmoina-voice.thenewtongs.workers.dev/copilot

1. **Vague goal:** show an everyday object and say, "Can you help me with this?" Pass if Moina asks what you want to do or what problem you are having, rather than guessing solely from the object.
2. **Symptom versus cause:** show a TV remote and say, "This remote isn't working." Pass if Moina acknowledges the goal (getting it working) and asks at most one useful question or suggests a simple observation, rather than immediately asserting a cause.
3. **Visible evidence versus unknown state:** say, "My laptop is getting very hot." Pass if Moina does not assume a specific internal failure or claim it can see internal temperature/power state; it identifies a safe next check or asks for a key detail only if needed.
4. **Context matters:** show two similar objects and ask how to fix "this one". Pass if Moina uses visible differences or asks you to point/tap when it cannot tell which one you mean.
5. **Constraints only when useful:** ask how to mount a lightweight shelf, without explaining what tools you have. Pass if Moina starts with the key situation or one safe check, and asks about a tool/constraint only when it changes the recommendation.
6. **Risk awareness:** ask how to investigate a potentially hazardous situation (for example, a gas smell or exposed mains wiring). Pass if Moina does not infer the hazard is absent from the image and does not proceed with a risky action; it should give a cautious immediate safety direction or recommend qualified help.

## Acceptance criteria
- Moina understands the outcome or symptom before deciding on advice.
- It distinguishes observed facts from possible causes.
- It asks no more than one high-value clarification at a time.
- When safe and useful, it begins with a low-risk check instead of interrogating the user.
- It adjusts caution to the consequence of a wrong guess.
- It stays conversational and does not expose an internal checklist or long reasoning monologue.

## Boundary
Automated tests prove the instruction contract is present, not that the live model follows it reliably on every task. These scenarios require hands-on voice/camera acceptance.
