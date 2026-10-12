# M33 — Universal task engine

## Goal

Make AskMoina useful across unfamiliar real-world tasks, not only a curated arranging or repair example. Treat the user's intended outcome as the organizing principle across organizing, comparing, setting up, assembling, repairing, troubleshooting, learning, inspecting, planning, creative work, and reasonable tasks outside this list.

## Implementation

- Extend the live Co-Pilot's system instruction with an explicit universal-task contract.
- Choose the lightest useful response: direct explanation, comparison, organization, setup, sequence, diagnosis, learning, or a safe next action.
- Keep categories internal. Do not ask users to choose a mode when their goal is clear.
- Retain the same evidence-led loop, adapting it to explanation-only and non-physical tasks as well as physical tasks.
- Do not claim to perform physical actions, change settings, or execute external operations.

## Synthetic acceptance

- [x] Prompt-contract tests cover broad task classes and unseen-task transfer.
- [x] Tests require the same observe/understand/act-or-explain/check/adapt loop without a forced repair flow.
- [x] Tests prevent exposing internal categories as required user-facing modes.
- [x] Tests require honest action boundaries.
- [x] TypeScript, asset synchronization, and the full release test suite are required by CI.

## Live-model and held-out-task acceptance — still required

Try several tasks not used while designing the prompts: compare two product labels, organize a mixed desk, explain a diagram in a textbook, help configure a familiar app, plan a simple project, and troubleshoot a harmless household issue. Pass only if Moina understands the stated outcome, asks only material questions, selects a fitting approach, avoids invented details, and checks results without forcing every task into a repair script. Use a variety of real users and objects; prompt tests alone do not establish general intelligence or task completion.
