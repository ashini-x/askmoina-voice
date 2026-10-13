# AskMoina product roadmap
Last updated: 2026-10-12 (M31–M36 deployed with evidence limits noted below; M37 speech contract and suite implemented with native-speaker acceptance pending; M38 benchmark tooling implemented with real-task runs pending).

## Product vision

AskMoina is a general-purpose, real-time visual copilot for solving problems in the physical world. A person points a phone camera at a situation, explains the goal naturally, and gets adaptive help that combines speech with useful visual instructions. The core loop is: see the world, understand the goal and current state, invent the next useful guide, observe the result, verify what changed, and adapt or recover. Repair is one use case, not the product boundary.

The ambition is not simply to add voice to a camera or decorate the view with AR. The long-term differentiator is a reusable system that chooses the right kind of help for an unfamiliar real task, grounds every instruction in current evidence, keeps guidance aligned with the world where technically possible, checks outcomes honestly, and gracefully admits when it cannot know.

## Shipped foundation — Milestones 1–22

Milestones 1–22 are deployed on the production Worker. The foundation includes live voice, the camera-first Co-Pilot, Assamese-English conversation support, memory/continuity controls, conditional web grounding, evidence-first scene instructions, local image-patch tracking, compact approximate focus overlays, a WebXR guide prototype, and bounded 2D visual primitives. The owner has smoke-tested portions of the foundation, but real-world behavior remains unproven outside the scenarios actually tested.

- **M11 — Camera-first visual reset:** keep the live camera dominant and move advanced controls out of the main path.
- **M12 — Natural voice co-pilot:** improve transcript merging, interruption handling, and reconnection affordances.
- **M13 — Conditional web grounding:** search when current or model-specific evidence matters, not for every turn.
- **M14 — Evidence-first scene understanding:** distinguish visible facts from guesses and preserve uncertainty.
- **M15 — Spoken-reference target selection:** resolve spoken references only when one candidate is clear; otherwise ask or request a tap.
- **M16 — Local patch tracking:** follow a user-anchored image patch with loss/reacquisition safeguards. This is not semantic identity tracking.
- **M17 — Minimal overlays:** keep approximate on-screen hints compact and never treat them as object segmentation or world-locked anchors.
- **M18 — Understand the actual problem:** separate the user's goal/symptom from suspected causes and ask only material clarifying questions.
- **M19 — Dynamic task planning:** select and resize the approach to the real task rather than forcing every request into a template.
- **M20 — Adaptive step-by-step guidance:** provide one manageable move, then adapt to the user's response and new evidence.
- **M21 — Observe, verify, recover:** compare before/after evidence carefully, preserve failed checks, and do not claim unverified success.
- **M22 — AI-directed visual primitives:** bounded lines, arrows, circles, outlines, ticks, and labels can be rendered as approximate screen-space drawings. They are not object detections or world anchors; dependable automatic progress verification remains future work.

## The legacy roadmap — Milestones 23–40

These milestones supersede the earlier numbering for the work that had not shipped. They are the working strategic roadmap and should be kept versioned as implementation progresses. Milestones may be refined based on measured failures, but don't silently narrow the product to a single task category.

### Phase 1 — Make the visual loop trustworthy

- **M23 — Visual-guide brain (implemented; deployed foundation; real-task acceptance pending):** the model proactively decides when a visual instruction will materially help, chooses the smallest useful primitive set, draws tap-free geometric references when object identity is not required, and avoids invented geometry or false success marks. Automated prompt/tool-contract tests are not proof of live-model reliability. See [M23 acceptance](acceptance/m23-visual-guide-brain.md).
- **M24 — Trustworthy camera geometry (implemented; synthetic checks passed; real-device acceptance pending):** map normalized source-frame coordinates through object-fit cover and viewport crop, support a mirrored front-camera preview consistently for visual guides and local target tracking, recompute guide geometry after viewport resize, and clear camera-dependent guidance on zoom changes, intrinsic video resize, tab hiding, or camera flip. Model-bound digital zoom uses the same centered crop as the preview, so guides remain normalized to the currently visible frame; native zoom acts on the camera stream. See [M24 acceptance](acceptance/m24-trustworthy-camera-geometry.md).
- **M25 — Live scene model (implemented; synthetic tests and deployed-bundle smoke passed; live-model/real-device acceptance pending):** maintain a short-lived, frame-tagged scene model with candidate IDs, labels, evidence type, model-reported confidence, approximate regions, visibility, and supported relations. Reject observations associated with stale frames or a previous camera view; flag ID/label conflicts as uncertain. This remains model-reported scene evidence, not verified object detection or measured geometry. See [M25 acceptance](acceptance/m25-live-scene-model.md).
- **M26 — Persistent spatial tracking (implemented; synthetic tests and deployed-bundle smoke passed; real-device acceptance pending):** associate a user-tapped local image patch with an explicit track record across local matches, occlusion, and cautious reacquisition; retain track identity through two consistent high-confidence reacquisition scans and remove the marker when confidence expires. Invalidate scene and track records on zoom/source/visibility changes. It is 2D image-patch tracking, not semantic identity tracking or world-locked AR. See [M26 acceptance](acceptance/m26-persistent-spatial-tracking.md).
- **M27 — Automatic visual verification (implemented; synthetic CI passed and active Worker bundle content verified; live-model/HTTP-route/real-device acceptance pending):** compare the same stable scene candidate across fresh before/after frames and classify the reported visible criterion as supported success, supported failure/no change, or ambiguous. Require direct evidence and consequence-adjusted confidence; consequential outcomes remain ambiguous without stronger independent confirmation. See [M27 acceptance](acceptance/m27-automatic-visual-verification.md).
- **M28 — Generative spatial language (implemented; synthetic CI passed and active Worker bundle content verified; live-model/real-device acceptance pending):** compose alignment guides, motion paths, placement-region outlines, target points, orientation arrows, and labels from bounded normalized points. They remain approximate 2D screen-space suggestions, not object segmentation, measured geometry, or world-locked tracking. See [M28 acceptance](acceptance/m28-generative-spatial-language.md).
- **M29 — Task world model (implemented; synthetic CI and active Worker bundle checks passed; live-model, direct HTTP-route, and real-device acceptance pending):** maintain a bounded session-local record of the user's goal, current state, one intended action, expected evidence, constraints, uncertainty, and recent events. Keep user reports distinct from guarded visual verification and reset task-specific outcomes when the goal changes. See [M29 acceptance](acceptance/m29-task-world-model.md).

### Phase 2 — Grounded expertise, safety, and one continuous reality loop

- **M30 — Grounded expertise (implemented; synthetic CI and active Worker bundle checks passed; exact source-content matching, live retrieval-quality, direct HTTP-route, and real-device acceptance pending):** pass explicit manufacturer/model/variant/part context into on-demand grounded search; prefer official manuals, diagrams, recalls, and safety notices; annotate whether identifiers appear in source titles/URLs; flag unknown model match and never transfer a neighbouring model's procedure. A title/URL check is not page-content or domain-ownership verification. See [M30 acceptance](acceptance/m30-grounded-expertise.md).
- **M31 — Safety and uncertainty engine (implemented; synthetic CI and production bundle checks passed):** use consequence/reversibility assessment plus a deterministic client-side hazard gate; block procedural overlays for high-consequence hazards, clear stale camera marks, show an explicit safety pause, and feed the gate result back to the live model. The gate is conservative best-effort protection, not a complete hazard detector or safety certification. Live task wording and phone acceptance remain pending. See [M31 acceptance](acceptance/m31-safety-uncertainty.md).
- **M32 — One continuous reality loop (implemented; synthetic CI and production smoke passed):** track camera/voice/AR observation modes, pause local camera tracking across immersive AR and background transitions, report when fresh camera evidence is unavailable, and hold camera-dependent overlays/verification until a new frame is sent. WebXR pose/hit-test is explicitly not new camera imagery. Real phone testing of AR exit/resume and foreground re-acquisition remains pending. See [M32 acceptance](acceptance/m32-continuous-reality-loop.md).

### Phase 3 — General-purpose, effortless, efficient, and accessible

- **M33 — Universal task engine (implemented; synthetic prompt-contract checks added; live-model/held-out-task acceptance pending):** extend the same observe/understand/act-or-explain/check/adapt loop across organization, comparison, setup/configuration, assembly, repair, troubleshooting, learning, inspection, planning, creative work, and unfamiliar tasks without forcing a task mode, physical action, or overlay. See [M33 acceptance](acceptance/m33-universal-task-engine.md).
- **M34 — Zero-learning camera-first UX (implemented; asset/prompt contract checks added; real-device usability acceptance pending):** retain the full camera and single Start action, invite natural-language goals with a few optional examples, explain one next move at a time, and keep technical controls tucked away. See [M34 acceptance](acceptance/m34-zero-learning-camera-ux.md).
- **M35 — Efficient intelligence (implementation and synthetic contracts added; production telemetry observation pending):** stable idle camera frames may be suppressed locally with a 2.4-second freshness heartbeat; motion, active task state, tracking, target selection, zoom, and fresh-evidence demand bypass suppression. Setup/first-audio/search latency and media counts are measured. Provider token usage is recorded only when returned; cost estimates stay null unless both explicit rates and provider token counts exist. See [M35 acceptance](acceptance/m35-efficient-intelligence.md).
- **M36 — Permission-based continuity (implementation and synthetic contracts added; device acceptance pending):** saved memories can be opted into only for future sessions, previewed before sharing, edited, exported as an encrypted backup, or deleted. A cross-tab opt-out marker overrides stale tab caches. Existing connected sessions must be ended to clear context already sent. See [M36 acceptance](acceptance/m36-permission-based-continuity.md).
- **M37 — Assam-first, world-ready speech (shared prompt contract and 15-case suite implemented; native-speaker audio acceptance not yet passed):** evaluate Assamese-English speech without treating one listener preference as a universal dialect rule. See [M37 acceptance](acceptance/m37-assam-first-speech.md).

### Phase 4 — Evidence, pilot, and scale

- **M38 — Moina Reality Benchmark (18-case score-only suite and scorer implemented; real-task acceptance not yet passed):** rate goal understanding, evidence, action fit, safety, uncertainty, verification, recovery, and clarity. Critical failures block the gate. See [M38 acceptance](acceptance/m38-moina-reality-benchmark.md).
- **M39 — Closed real-world pilot:** work with a small opt-in group, test varied genuine tasks, gather structured feedback with consent, fix blockers, and rerun the same acceptance suite.
- **M40 — Public beta and capability platform:** stage the launch, monitor reliability and spend, test defined concurrency, keep rollback/support ready, and expose trusted extension points only after the core loop is dependable.

## Parallel implementation track — Selective response cards (RC1–RC8)

RC1–RC8 is a separate, additive track for selecting and rendering useful response cards inside the existing live Co-Pilot. It does not replace or renumber M1–M40, and it must reuse the existing voice, camera, task-state, safety, and verification systems rather than rebuilding them.

- **RC1 — Selective response-card policy:** acceptance examples define when to speak, when to show a card, and when to use both. Policy only; no feature implementation implied. See [selective response-card acceptance](acceptance/selective-response-cards.md).
- **RC2 — Structured live tool:** add a bounded `display_response_card` tool separate from `display_screen_overlay`, with strict schema and protocol validation.
- **RC3 — Responsive card area:** add an on-demand compact card tray to the existing Co-Pilot; preserve camera visibility and call controls. Match ChatGPT-style rich-response interactions (useful icons, checkmarks, expandable details) within Apple's restrained minimalism; use translucent semantic HTML surfaces that preserve readability, and a bottom Searching/Thinking status with honest progress signalling.
- **RC4 — Three safe renderers:** render `steps`, `key_details`, and `comparison` cards from validated data using safe DOM text handling, not model-generated HTML. Render checkmarks only for confirmed/evidence-supported progress, and include accessible translucent styling plus a readable fallback.
- **RC5 — Speech/card lifecycle:** coordinate concise speech with persistent details; update the current task card, avoid duplicates, handle interruptions, and clear stale cards on task changes.
- **RC6 — Camera and safety integration:** keep response cards distinct from spatial overlays; preserve safety gating and current-evidence requirements.
- **RC7 — Automated regression coverage:** test policy, schemas, rendering, lifecycle, accessibility, safety, and parity between public assets and embedded Worker assets.
- **RC8 — Live prompt and user evaluation:** verify both correct card use and correct suppression across English and Assamese-English prompts; extend M38 scoring without treating synthetic checks as proof of real-task success.

Current status: **RC1 policy drafted for acceptance; RC2–RC8 not started.** Do not mark any RC item complete merely because its design or code exists; record synthetic, live-model, and real-device evidence separately.

## Release and evidence discipline

A successful deployment or healthy endpoint proves that a service is reachable; it does not prove that Moina selected the correct visual guide or helped complete a physical task. Automated validation, synthetic service checks, live-model checks, and real-device acceptance are distinct evidence levels and must be reported separately.

Every milestone should have explicit pass/fail criteria, regression tests, and an acceptance record. Never claim semantic object recognition, reliable world tracking, wiring verification, physical task completion, dialect quality, or scale without an appropriate evaluation. Treat failures as product data: reproduce them, identify the earliest failed link in the reality loop, fix that link, and rerun the same case.

## Product loop

See → Understand → Select → Plan a visual guide → Render → Track → Guide → Verify → Recover.

The order matters: a beautiful 3D arrow is not a breakthrough if it points at the wrong part, drifts when the camera moves, or claims success without evidence.
