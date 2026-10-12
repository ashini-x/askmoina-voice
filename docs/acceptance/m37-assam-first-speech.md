# M37 — Assam-first, world-ready speech

## Implemented
- A shared speech contract is included in regular Live voice and camera Co-Pilot instructions.
- It follows the user's language, preserves English pronunciation in mixed speech, responds to corrections, and avoids treating one person's preference as a universal Upper Assam norm.
- A versioned 15-case listening suite covers everyday speech, code-switching, English controls, word-specific feedback, language switches, repeat/slow requests, tone, local-name uncertainty, ambiguity, register, noisy input, and current information.
- The run format stores ratings and non-identifying notes only; it rejects captured audio, transcripts, screenshots, and contact fields.

## Synthetic acceptance
- [x] Contract included in voice and Co-Pilot instructions.
- [x] Suite structure, case IDs, behaviours, and thresholds are validated.
- [x] Scorer computes overall/dimension scores; critical failures block a pass.
- [x] Synthetic scoring and score-only privacy tests run in CI.

## Human acceptance — NOT YET PASSED
Recruit consenting Assamese speakers from at least two Upper Assam localities; use non-identifying evaluator codes and do not retain recordings by default. Rate at least 12 of 15 cases. Gate: overall >=85%; language match, naturalness, and code-switching >=85%; pronunciation clarity >=80%; zero critical failures. Include multiple speakers. A single listener's word preference is useful feedback, not a community-wide result. Listen to the generated audio itself; transcripts cannot establish pronunciation or pacing.

Create a score sheet: node scripts/reality-benchmark.mjs init speech ./speech-run.json
Rate each dimension 0 (fail), 1 (partial), or 2 (pass); mark critical failures and keep notes non-identifying. Score it: node scripts/reality-benchmark.mjs score speech ./speech-run.json
