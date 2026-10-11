# AskMoina product roadmap
Last updated: 2026-10-11 (M18 problem-understanding instructions deployed; real-task acceptance pending)

## Product vision
AskMoina is a general-purpose, real-time visual copilot for solving problems in the physical world. A user points a camera at a situation and asks naturally; Moina interprets the goal and visual evidence, selects and tracks relevant targets when useful, guides one step at a time, observes results, adapts, and clearly communicates uncertainty or risk. Electrician work is one example, not the product boundary.

## Shipped foundation
Milestones 1–18 are deployed on the production Worker; a follow-up tracking-anchor reliability fix prevents untracked model-generated highlights from appearing at a guessed screen position. Milestone 11 simplified the Co-Pilot to a camera-first interface with contextual controls and opt-in captions. Milestone 12 improves live transcript fragment merging, interruption audio cleanup, conversational follow-up guidance, and explicit retry affordances. The present release includes live voice, the camera-first Co-Pilot prototype, approximate screen-space focus markers and local patch tracking, an experimental WebXR cue/guide flow, multi-step AR guide behavior, saved local scene templates, memory vault, operations dashboard, usage safeguards, and release validation. M14 adds evidence-first scene instructions and was smoke-tested by the product owner; this is not proof of general object-recognition accuracy. Existing cues remain approximate and are not semantic object segmentation.

## Remaining roadmap

### Phase 1 — Effortless JARVIS experience
- **M11 — Camera-first visual reset (deployed):** live camera dominance, restrained focus overlays, secondary controls under More, and captions on demand. Real-device acceptance was confirmed by the product owner.
- **M12 — Natural voice copilot (deployed 2026-10-11):** merge overlapping transcription fragments, suppress stale audio after an interruption, strengthen follow-up and topic-switch behavior, and show an explicit Try again action after unexpected disconnects. Automated validation and post-deploy smoke tests passed. Hands-on voice interruption, follow-up quality, and reconnect recovery still require real-browser/device acceptance.

### Phase 2 — Visual awareness
- **M13 — Conditional web grounding (deployed 2026-10-11):** use native Search grounding for current facts in normal voice and a bounded grounded-search tool in Co-Pilot for equipment documentation or changing troubleshooting guidance. Avoid needless searches; source URLs and uncertainty must be surfaced, and search results must never be treated as visual recognition evidence. The grounded lookup uses Gemini 3.8 Flash on Vertex's global endpoint, independent of the Live session region. Real-session search usefulness, relevance, and latency still require hands-on acceptance.
- **M14 — Scene understanding (deployed and smoke-tested 2026-10-11):** use an explicit evidence-first protocol for candidate objects, components, visible text, and visible relationships; distinguish direct observations from plausible interpretations; preserve uncertainty for ambiguous or unreadable details. The owner confirmed the implementation was working; that does not prove broad visual accuracy.
- **M15 — Spoken-reference target selection (deployed and owner-tested 2026-10-11):** resolve “this one” and “that part” against recent camera evidence when one candidate is clear; when ambiguous, ask one short question or request a tap. A tap is sent as a normalized camera-frame point and treated as user intent, not proof of object identity. The existing camera-first UI stays in place; no large new control panel or claim of semantic segmentation is introduced. Main-branch CI, automated tests, Worker dry-run, deployment, and production smoke checks passed.
- **M16 — Persistent visual tracking (deployed; follow-up hardening 2026-10-11):** retain a tapped local image patch during camera movement; suppress guessed markers until the user anchors an exact point, reject nearly uniform patches, require two consistent wider-frame matches for reacquisition, and hide stale markers after loss. This remains local image-patch matching, not semantic identity tracking. Automated checks, Worker dry-run, deployment, and production smoke tests passed; acceptance on physical devices remains pending.
- **M17 — Minimal target overlays (deployed 2026-10-11; phone layout acceptance pending):** reduce target brackets, add a small center-point indicator, shrink labels and one-line instruction previews, and keep visual guidance compact over a camera-first scene. A follow-up tracking-anchor fix additionally suppresses untracked, guessed markers. Cues remain approximate screen-space hints; they are not semantic object boundaries or world-locked AR.

### Phase 3 — Problem solving
- **M18 — Understand the user's problem (deployed 2026-10-11; real-task acceptance pending):** before proposing action, infer the desired outcome or symptom, relevant visible/user-provided context, known facts versus hypotheses, the one missing fact that could change the next step, and the consequence if wrong. Keep this assessment internal and conversational; ask one high-value clarification only when needed, otherwise start with a low-risk observation/check. Do not confuse a symptom with a cause or assume the visible object is the problem.
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
