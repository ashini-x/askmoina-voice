# M0 — Assamese Gen-Z Product Identity and Differentiation

**Initiative:** Assamese Gen-Z conversational experience (M0–M9)  
**Status:** M0 definition documented; no application/runtime changes in this milestone  
**Review date:** 2026-10-18  
**Next milestone:** M1 — baseline and performance benchmark

## 1. Why this initiative exists

AskMoina already has a general-purpose, real-time visual Co-Pilot roadmap. This additive initiative strengthens one of its defining experiences: natural, locally fluent Assamese-English conversation for people who speak the way Assamese people actually speak day to day.

The ambition is not merely to make a model capable of producing Assamese text. AskMoina should feel easy and enjoyable to talk to because it follows the user's language, understands context and conversational intent, responds with appropriate warmth and humour, speaks without unnecessary delay, and can connect that conversation to useful live visual assistance.

This initiative does **not** renumber or replace the existing M1–M40 engineering roadmap or RC1–RC8 response-card track. It is a separate product-definition and delivery track.

## 2. Product north star

> **AskMoina is a real-time Assamese-English voice and visual Co-Pilot for everyday life: culturally fluent, Gen-Z-aware, immediately useful, and natural to talk to.**

The desired experience is a familiar, comfortable conversational rhythm—not a formal question-answer machine, translator, call-centre bot, or exaggerated imitation of young people.

The product should feel locally fluent through its behaviour. It must not claim to be human or fabricate personal childhood, friendships, memories, or lived experience.

## 3. Initial audience

**Primary audience:** Assamese-speaking Gen-Z and young-adult users who naturally mix Assamese and English in conversation and want a convenient voice-first assistant for everyday questions, learning, planning, social conversation, and practical tasks.

**Initial language-quality benchmark:** Upper Assam conversational usage, with other Assamese regions and speakers represented as the evaluation set expands. Upper Assam is the starting benchmark, not a claim that one dialect represents all Assamese speakers.

**Usage context:** Short, spontaneous mobile conversations; casual check-ins; learning and work; everyday decision-making; and camera-assisted help for visible real-world situations.

Language and product design must accommodate Assamese script, Romanized Assamese, English, and natural code-switching. It must not assume that every user prefers the same script, vocabulary, degree of slang, or regional pronunciation.

## 4. Core product promise

1. **Talk naturally.** Users should be able to speak in their own Assamese-English mix without translating themselves or composing formal prompts.
2. **Get the vibe right.** AskMoina should distinguish banter, excitement, uncertainty, frustration, and serious requests, choosing a proportionate response instead of using the same canned tone everywhere.
3. **Stay useful.** A conversational personality must not weaken factual accuracy, clear instructions, appropriate uncertainty, or safety.
4. **Respond promptly.** Natural speech, turn-taking, and low latency are part of the product identity. Language enrichment must not introduce avoidable work into every live turn.
5. **Connect conversation to the world.** Voice, camera, grounded visual help, task context, and user-controlled memory should feel like one coherent product.
6. **Respect the user.** Memory is transparent and controllable. Engagement should arise from usefulness, cultural familiarity, and enjoyable conversation—not guilt, deceptive intimacy, compulsive mechanics, or manufactured dependency.

## 5. Differentiation hypothesis

AskMoina's intended advantage is the **combination** of:

- Live, bidirectional voice conversation rather than a primarily text-based assistant.
- A deliberately evaluated Assamese-English conversational style, starting with Upper Assam usage rather than generic language switching alone.
- A recognizable, consistent, warm Gen-Z personality that can be playful without forcing slang and serious without sounding robotic.
- A camera-first visual Co-Pilot in the same experience, so users can discuss what they see and receive contextual guidance.
- Useful continuity through account-scoped history and explicitly user-controlled memory.
- A restrained, premium, mobile-first experience designed around the live interaction.

These are product hypotheses and capabilities to validate, not evidence that the market has no adjacent products. Product claims must reflect the current deployed implementation and measured results.

## 6. Initial competitive landscape

This is an **initial public-surface scan dated 2026-10-18**, not an exhaustive competitive audit or hands-on benchmark. The entries below describe publicly advertised positioning; they do not independently verify quality or feature performance.

| Product | Publicly advertised adjacent capability | Implication for AskMoina |
| --- | --- | --- |
| [Assamese AI (Google Play)](https://play.google.com/store/apps/details?id=com.assamese.ai) | Assamese/English AI chat and voice input. | Assamese chat and voice input alone are not defensible uniqueness claims. |
| [Axom AI](https://aiaxom.co.in/) | Assamese audio/voice mode, a broader regional AI platform, and a custom knowledge-base/RAG offering. | Assamese AI and RAG are already publicly marketed; differentiation must be experiential, not simply technical. |
| [Baani AI](https://voiceset.lovable.app/) | Voice typing across Indian languages, including Assamese-English code-switching. | Code-switching and local speech input are adjacent capabilities, but dictation is a different primary job from ongoing voice-to-voice companionship and visual help. |
| [Edesy Assamese Voice AI](https://edesy.in/ai-voice-assistant/languages/assamese) | Assamese voice-assistant/agent offerings oriented to business deployment and customer interactions. | Assamese speech agents already exist in business contexts; avoid claiming that Assamese voice AI itself is new. |
| [Aakhor AI](https://aakhor.in/) | Assamese typing, phonetic input, and word prediction. | Local-language writing tools are adjacent but do not define the AskMoina experience. |
| [Project Pathok](https://groups.google.com/g/xobdo/c/lmeGUoaJHDQ) | Assamese text-to-speech access. | Speech output alone is not the differentiator. |

**Conclusion from this scan:** There are adjacent products in Assamese AI chat, voice input, code-switching, speech output, RAG, and business voice agents. The initial review does not establish a product with the same complete combination and quality ambition as AskMoina, but it also does not prove that no such competitor exists.

**Claims policy:** Do not market AskMoina as “the first”, “the only”, or “nothing like it exists” until a broader, dated competitive review and feature-level verification justify that exact claim. A defensible positioning hypothesis is “a real-time Assamese-English voice and visual Co-Pilot built for natural everyday conversation.”

## 7. Personality principles

- Follow the user's language and code-switching naturally; do not translate everything into formal Assamese.
- Mirror the user's level of casualness rather than pushing slang, “bro/yaar”, fillers, laughter, or Gen-Z expressions into every turn.
- Prefer short, responsive spoken turns. Leave conversational space and handle interruption gracefully.
- Use humour only when it fits. In serious, sensitive, safety-critical, or uncertain situations, prioritize calm clarity.
- Choose locally appropriate words only when the context supports them. Do not fabricate dialect vocabulary or treat a regional variant as universal.
- Preserve accuracy and uncertainty. A confident local tone must never disguise a guess as a fact.
- Be warm and socially aware without claiming human experiences, needs, exclusivity, or reciprocal emotional dependence.

## 8. Scope boundaries

### In scope for the M0–M9 initiative

- Define and evaluate the product's Assamese-English personality and audience.
- Establish a licensed, source-attributed, native-reviewed language and phrase reference.
- Improve word-specific pronunciation guidance and realistic audio evaluation.
- Measure live turn-taking, first-audio latency, interruptions, continuity, and reliability.
- Evaluate bounded contextual retrieval if the language corpus grows beyond effective rule/example lookup.
- Integrate the conversation quality with existing voice, visual Co-Pilot, history, and user-controlled memory.
- Complete private pre-release validation and release one polished product.

### Not assumed or authorized by this definition alone

- A Pinecone, Chroma, or Cloudflare Vectorize deployment.
- A new embedding model on every user turn.
- Silero VAD or a fixed 30–50 ms end-of-speech threshold.
- An external TTS cascade replacing Gemini Live native audio.
- Fine-tuning or training a model on public or private recordings without rights, consent, and a reviewed data plan.
- A claim that AskMoina has a native Upper Assam accent before native-speaker evaluation supports it.
- A claim of complete market uniqueness, universal Assamese dialect coverage, or readiness for unlimited scale.

The existing WebSocket, native-audio, D1 pronunciation-reference, and live turn-detection path remains the baseline until measurements justify a change.

## 9. Release philosophy

The intended release is one polished public product, not an open public beta used to discover basic defects. Before release, privately validate a frozen release candidate with a documented test set, automated checks, security/privacy review, target-device checks, and consenting Assamese-speaking reviewers.

This is not a commitment to skip human validation. Cultural naturalness cannot be established by unit tests alone. Private reviewers are a pre-release quality gate; they are not a substitute for production monitoring and a critical-issue response process after launch.

Every claim about local naturalness, dialect, latency, safety, reliability, and scale must be supported by the appropriate kind of evidence. A green build or healthy endpoint does not prove speech quality.

## 10. Measurement framework for M1

M1 establishes the baseline before new conversational changes. It must record, rather than assume, the present performance of:

- Time from end of user speech to first audible assistant audio (p50 and p95 where sample counts support them).
- Session setup success and time to first assistant audio.
- False turn endings, clipped speech, interruption handling, and reconnect outcomes.
- Native-speaker ratings of naturalness, regional fit, code-switching, pronunciation, tone, and response appropriateness.
- Task correctness and usefulness, kept distinct from stylistic preference.
- Retrieval time/cost only if retrieval is introduced and can be measured.

Targets should be set after measuring a reproducible baseline and the quality requirements. Do not invent targets or declare improvements without comparable measurements.

## 11. M0 acceptance criteria

M0 is accepted as a **product-definition milestone** when this document makes the following explicit:

- One product north star, primary audience, and initial regional benchmark.
- Differentiation hypothesis grounded in a dated initial market scan.
- Clear principles for personality, language behavior, accuracy, latency, user control, and respectful engagement.
- Scope boundaries that prevent premature infrastructure additions.
- A final-product release philosophy that rejects public beta as a substitute for private pre-release acceptance.
- A measurable baseline framework and a clearly named next milestone.

**M0 outcome:** Product identity and differentiation are documented. This does not mean the stronger personality has been implemented, native-speaker quality has passed, market exclusivity has been proven, or the final product is ready to launch.

**Next:** M1 — measure the current implementation and establish reproducible baseline results.
