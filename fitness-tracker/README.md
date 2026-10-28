# Discipline — AskMoina Fitness Tracker

A separate mobile-first PWA for a personal training routine, with a deliberately simple Today / Calendar / Progress / Routine interface.

## Independent deployment

Worker: `askmoina-fitness-tracker`

Deploy from repository root:

    npx wrangler deploy --config fitness-tracker/wrangler.jsonc

This Worker has its own configuration. It does not modify AskMoina Voice production settings.

## Long-lived core

- Versioned data schema and migration from the first tracker release.
- Indefinitely repeating training cycle; no 14-day app expiry.
- Routine times, workout types, exercises, session assignment and meal text are editable inside the app.
- Calendar history, complete/missed tasks, notes and optional weight/waist check-ins.
- Portable JSON backup/restore and 30-day calendar reminder export (.ics).
- Future voice/automation work can be added as optional integrations; it is not required for the core tracker.

## Data and reminders

History stays in this browser's local storage; it is not uploaded or synced across devices. Download a backup periodically, especially before changing phones. Import the ICS file into the phone calendar and enable calendar notifications for alerts while the PWA is closed.

No app can be guaranteed to run unchanged for 100 years because browser, device and hosting platforms may change. The goal is to keep the routine editable and data schema versioned so changing goals does not require a code rewrite.

Food portions and protein targets are estimates. Adapt them to age, health, budget and appetite. Keep runs conversational and stop for sharp pain.