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
- Beginner guides open directly inside task cards: illustrated exercise guides with setup, step-by-step movement, sets/reps, rest, common mistakes and easier variations; run/walk progressions; and food-timing tips.
- A separate stamina guide covers aerobic progression and general, non-judgmental stop–start education for ejaculation control. It distinguishes physical endurance from ejaculation control and does not promise a specific outcome or prescribe medicine.
- Future voice/automation features can be added as optional modules without becoming prerequisites of the core tracker.
- PWA shell with basic offline page/app-shell caching.

## Data and reminders

History stays in this browser's local storage; it is not uploaded or synced across devices. Download a backup periodically, especially before changing phones. Import the ICS file into your phone calendar and enable calendar notifications for alerts while the app is closed.

The app defaults to an Apple-inspired dark interface and uses self-contained SVG movement illustrations so exercise guidance does not depend on external image services.

No app can be guaranteed to run unchanged for 100 years because browser, device and hosting platforms may change. The goal is to keep the routine editable and data format versioned so changing goals doesn't require a code rewrite.

Food portions and protein targets are estimates. Adapt them to age, health, budget and appetite. Keep runs conversational and stop for sharp pain.
