# AskMoina product roadmap
Last updated: 2026-10-12 (M29–M30 synthetic CI passed: 37 test files and 227 tests; Cloudflare active Worker bundle contains both milestones' markers; live-model, source-content matching, direct HTTP-route, and physical-device acceptance pending)

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
- **M31 — Safety and uncertainty engine:** account for consequence and reversibility, pause when safety-critical facts are ambiguous, and prevent persuasive overlays from masking uncertainty or directing hazardous actions.
- **M32 — One continuous reality loop:** coordinate voice, camera frames, local tracking, and WebXR so a mode transition does not silently stop the observation needed to guide and verify the task.

### Phase 3 — General-purpose, effortless, efficient, and accessible

- **M33 — Universal task engine:** reuse the same observe/understand/plan/guide/verify/recover capabilities across organization, comparison, setup, assembly, repair, troubleshooting, and learning; validate on held-out tasks rather than only curated demos.
- **M34 — Zero-learning camera-first UX:** after permission and Start, make the next action obvious and keep mode switches, panels, and expert controls out of the main interaction unless they are genuinely needed.
- **M35 — Efficient intelligence:** measure latency and inference cost; use fast local techniques for suitable low-latency work and higher-capability reasoning for difficult cases, with explicit fallback behavior.
- **M36 — Permission-based continuity:** make saved memory optional, inspectable, correctable, exportable, and deletable; keep the core copilot useful without saved memory.
- **M37 — Assam-first, world-ready speech:** evaluate real Upper Assam speakers and natural Assamese-English code-switching, then broaden language and accent coverage through measured test suites rather than intuition.

### Phase 4 — Evidence, pilot, and scale

- **M38 — Moina Reality Benchmark:** create repeatable real-task evaluations for task completion, target mistakes, false completion, unsafe instructions, recovery, latency, and cost; retain failures as regression cases.
- **M39 — Closed real-world pilot:** work with a small opt-in group, test varied genuine tasks, gather structured feedback with consent, fix blockers, and rerun the same acceptance suite.
- **M40 — Public beta and capability platform:** stage the launch, monitor reliability and spend, test defined concurrency, keep rollback/support ready, and expose trusted extension points only after the core loop is dependable.

## Release and evidence discipline

A successful deployment or healthy endpoint proves that a service is reachable; it does not prove that Moina selected the correct visual guide or helped complete a physical task. Automated validation, synthetic service checks, live-model checks, and real-device acceptance are distinct evidence levels and must be reported separately.

Every milestone should have explicit pass/fail criteria, regression tests, and an acceptance record. Never claim semantic object recognition, reliable world tracking, wiring verification, physical task completion, dialect quality, or scale without an appropriate evaluation. Treat failures as product data: reproduce them, identify the earliest failed link in the reality loop, fix that link, and rerun the same case.

## Product loop

See → Understand → Select → Plan a visual guide → Render → Track → Guide → Verify → Recover.

The order matters: a beautiful 3D arrow is not a breakthrough if it points at the wrong part, drifts when the camera moves, or claims success without evidence.
