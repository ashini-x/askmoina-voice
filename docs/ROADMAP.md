# AskMoina product roadmap
Last updated: 2026-10-11 (M13 production deployment)

## Product vision
AskMoina is a general-purpose, real-time visual copilot for solving problems in the physical world. A user points a camera at a situation and asks naturally; Moina interprets the goal and visual evidence, selects and tracks relevant targets when useful, guides one step at a time, observes results, adapts, and clearly communicates uncertainty or risk. Electrician work is one example, not the product boundary.

## Shipped foundation
Milestones 1–13 are deployed on the production Worker. Milestone 11 simplified the Co-Pilot to a camera-first interface with contextual controls and opt-in captions. Milestone 12 improves live transcript fragment merging, interruption audio cleanup, conversational follow-up guidance, and explicit retry affordances. The present release includes live voice, the camera-first Co-Pilot prototype, approximate screen-space focus markers and local patch tracking, an experimental WebXR cue/guide flow, multi-step AR guide behavior, saved local scene templates, memory vault, operations dashboard, usage safeguards, and release validation. These cues are not general object recognition or verified real-world understanding.

## Remaining roadmap

### Phase 1 — Effortless JARVIS experience
- **M11 — Camera-first visual reset (deployed):** live camera dominance, restrained focus overlays, secondary controls under More, and captions on demand. Real-device acceptance was confirmed by the product owner.
- **M12 — Natural voice copilot (deployed 2026-10-11):** merge overlapping transcription fragments, suppress stale audio after an interruption, strengthen follow-up and topic-switch behavior, and show an explicit Try again action after unexpected disconnects. Automated validation and post-deploy smoke tests passed. Hands-on voice interruption, follow-up quality, and reconnect recovery still require real-browser/device acceptance.\n- **M13 — Conditional web grounding (deployed 2026-10-11):** regular voice can use native Google Search grounding when current information materially helps; Co-Pilot can call a worker-executed grounded lookup for model-specific manuals, compatibility, recalls, and troubleshooting. Co-Pilot lookups are limited to two attempts per session, use an eight-second cooldown and 12-second timeout, clip queries to 240 characters, and return verifiable source URLs. Web results remain untrusted evidence and do not prove visual component identification. Release validation and production smoke tests passed; real-session search usefulness, relevance, and latency still require hands-on acceptance.

### Phase 2 — Visual awareness
- **M13 — Conditional web grounding (deployed 2026-10-11):** use native search grounding for current facts in normal voice and an explicit, bounded grounded-search tool in Co-Pilot for equipment documentation or changing troubleshooting guidance. Avoid needless searches; source URLs and uncertainty must be surfaced, and search results must never be treated as visual recognition evidence.
- **M14 — Scene understanding:** identify candidate objects, components, labels, visible text, and relationships; distinguish observation from assumption.
- **M15 — Automatic target selection:** resolve spoken references to a visible region; ask or allow a simple tap when ambiguous.
- **M16 — Persistent visual tracking:** track the selected region through camera motion, reacquire after obstruction, and hide/fade when confidence is lost.
- **M17 — Minimal target overlays:** draw thin, compact outlines, pointers, and short labels directly over the camera scene. World-anchored AR is optional enhancement, not a prerequisite.

### Phase 3 — Problem solving
- **M18 — Understand the user's problem:** infer the task goal, known facts, relevant objects, missing information, and risk.
- **M19 — Dynamic task planning:** generate an appropriate plan for the specific situation rather than force every task into fixed templates.
- **M20 — Adaptive step-by-step guidance:** provide one useful action at a time and adjust using user feedback and new visual evidence.
- **M21 — Observe, verify, recover:** compare visible states before/after actions, ask the user to confirm facts the camera cannot see, and revise failed steps.
- **M22 — Evidence-grounded guidance:** match model numbers and labels to reliable manuals/schematics; surface sources and uncertainty.
- **M23 — Safety and uncertainty engine:** escalate caution for high-consequence tasks; never infer hidden or hazardous physical states from appearance alone.

### Phase 4 — General-purpose coverage
- **M24 — Reusable task engine:** share scene, target, reasoning, planning, guidance and recovery primitives across categories.
- **M25 — Cross-scenario evaluation:** test repairs, setup, assembly, troubleshooting and unfamiliar objects, including cases not explicitly scripted.

### Phase 5 — Reliability and readiness
- **M26 — Device and environment reliability:** test low light, glare, camera movement, occlusion, poor network, disconnects and recovery.
- **M27 — Voice, privacy and security acceptance:** evaluate Upper Assam speech quality, consent, memory opt-in/out, data retention, authentication, and abuse protection.
- **M28 — Latency, cost and capacity engineering:** measure p50/p95 first-audio latency, vision/search budgets, session recovery and defined target concurrency. Prove capacity by load testing; do not infer it from successful deploys.
  
### Phase 6 — Release
- **M29 — Closed real-world pilot:** invite a small group, observe genuine tasks, collect structured feedback, fix blockers, and repeat acceptance tests.
- **M30 — Public beta and progressive scaling:** launch gradually with monitoring, support, spend safeguards, feedback and rollback. Expand categories only when each is sufficiently reliable and safe.
- **Final destination — General-purpose visual copilot:** a user can show Moina a real-world problem, converse naturally, receive evidence-grounded guidance, see relevant targets highlighted, and have the guidance adapt as the situation changes.

## Product loop
See → Understand → Select → Track → Guide → Verify → Recover.

Every milestone should strengthen this loop. UI effects and 3D cues are secondary to reliable target selection, context, problem solving, and safe adaptation.

## Release discipline
A successful deployment/health endpoint is not a complete acceptance test. Preserve a versioned roadmap; use feature branches, automated checks, post-deploy smoke tests, and real device/user acceptance for behavior that automation cannot establish. Never claim general object recognition, wiring verification, task completion, dialect quality, or scale without an appropriate evaluation.
