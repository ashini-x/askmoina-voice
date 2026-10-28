# Discipline — AskMoina Fitness Tracker

A separate mobile-first, dark-by-default PWA for a personal training routine, with a simple Today / Calendar / Progress / Routine interface and tap-to-open beginner guides.

## Independent deployment

Worker: `askmoina-fitness-tracker`

From repository root:

    npx wrangler deploy --config fitness-tracker/wrangler.jsonc

This Worker has its own configuration and does not modify AskMoina Voice production settings.

## Long-lived core

- Versioned data schema and migration from the first tracker release.
- Indefinitely repeating training cycle; no 14-day app expiry.
- Routine times, workout types, exercises, session assignment and meal text are editable inside the app.
- Calendar history, completed/missed tasks, notes and optional body measurements.
- Portable JSON backup/restore and 30-day calendar reminder export (.ics).
- UI and browser controller are separate modules (`src/ui.js`, `src/app.js`).
- Default schedule: wake at 5:30 AM, run/walk at 6:00 AM on Monday/Wednesday/Friday, brisk recovery walks on Tuesday/Thursday/Saturday, four evening strength sessions (6:00 PM Monday/Tuesday/Thursday/Friday), recovery/mobility on Wednesday/Saturday, and Sunday off. Meals are timed around the sessions. The schedule is editable in the app and existing check-ins are preserved during the one-time schedule migration.
- Strength and ab training are integrated into the existing four evening gym sessions: cable crunch on Upper A, reverse crunch on Upper B, dead bug on Lower A and plank on Lower B. A one-time migration adds the two upper-body ab movements to existing routines unless that session already includes a crunch/ab/core movement; personal exercise edits and logs are preserved.
- Food guides include moderate-cut basics: protein at meals, measured portions, no crash dieting, and a reminder that abs cannot selectively burn belly fat. This is not a personalised calorie prescription.
- Beginner guides open inside task cards: animated exercise movement demos, red target-muscle highlights, short form instructions, sets/reps/rest, run/walk progression, and food timing. Times are shown in 12-hour AM/PM format.
- The short control practice is embedded in the existing wind-down task (no extra checklist item or separate training session): slow breathing, a few gentle pelvic-floor contractions only if comfortable, full relaxation, and optional stop–start guidance. It avoids guarantees and advises clinical support for persistent distress or pain.
- Future voice/automation features can be added as optional modules without becoming prerequisites of the core tracker.
- PWA shell with basic offline page/app-shell caching.

## Data and reminders

History stays in this browser's local storage; it is not uploaded or synced across devices. Download a backup periodically, especially before changing phones. Import the ICS file into your phone calendar and enable calendar notifications for alerts while the app is closed.

The app defaults to an Apple-inspired dark interface and uses self-contained SVG movement illustrations so exercise guidance does not depend on external image services.

No app can be guaranteed to run unchanged for 100 years because browser, device and hosting platforms may change. The goal is to keep the routine editable and data format versioned so changing goals doesn't require a code rewrite.

Food portions and protein targets are estimates. Adapt them to age, health, budget and appetite. Keep runs conversational and stop for sharp pain.
