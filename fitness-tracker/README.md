# AskMoina Fitness Tracker

A separate personal-use PWA for daily gym sessions, run/walk intervals, meal timing, accountability and progress.

## Deploy independently

From repository root run:

    npx wrangler deploy --config fitness-tracker/wrangler.jsonc

This configuration is separate from the root Worker. It does not bind AskMoina's D1 databases, Durable Objects, Gemini credentials or production routes.

## MVP

- Monthly calendar, completion markers and a repeating 14-day gym/run plan.
- Meal timing with household portion guidance.
- Gym sets/reps, recovery guidance, mark done/undo/missed, and firm accountability copy.
- Editable gym/run/sleep times, progress summary, JSON backup and restore.
- PWA manifest/service worker, browser notifications while active, and 14-day phone-calendar alarm export.

Progress stays in local browser storage. It is not uploaded or synced. Use JSON backup/restore to move it. Browser notifications require the app to be running; the ICS export is the option for reminders when the app is closed. Import it into your phone calendar and keep calendar notifications enabled.

Food/protein targets are estimates; adapt them to age, sex, health and appetite. Keep runs conversational, avoid training through sharp pain, and ask a trainer to teach the Romanian deadlift.
