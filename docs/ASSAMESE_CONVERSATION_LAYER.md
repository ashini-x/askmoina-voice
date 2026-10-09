# Assamese Conversation Layer v1

## Purpose

Improve AskMoina's conversational behavior for Assamese speakers, particularly in Upper Assam, without pretending that a prompt alone can guarantee a native accent or natural cadence.

## What this layer changes

- Prioritizes Assamese when the user speaks Assamese and supports natural Assamese-English code-switching.
- Encourages short, responsive spoken turns, empathy where appropriate, and room for the user to speak.
- Discourages fake fillers, forced slang, textbook-style monologues, and canned replies.
- Keeps regional language respectful: follow the user's expressions rather than inventing a dialect.
- Preserves the existing truthfulness and selected-memory rules.

## Public data strategy

Do not scrape arbitrary internet audio or text into production. Public availability does not automatically mean a dataset permits reuse, redistribution, model training, or voice cloning. For each candidate corpus, record its source, license, permitted uses, attribution requirements, language/dialect coverage, and whether it contains personally identifying material. Prefer openly licensed Assamese text/audio corpora with explicit terms, and keep source-level provenance.

Public data can help create test examples and discover vocabulary, but it does not automatically teach the deployed Gemini Live model a new accent. The current implementation sends behavioral instructions to the existing live model; it does not fine-tune that model.

## Evaluation loop

1. Build a small, versioned set of everyday scenarios: greetings, emotional support, code-switching, clarification, local expressions, and factual questions.
2. Have the product owner review Assamese wording and mark unnatural phrasing, wrong language choice, misunderstandings, and overlong turns.
3. Test the same scenarios after every prompt/model change and compare outcomes.
4. Keep microphone audio and transcripts out of persistent logs by default. If collecting examples, get explicit consent, minimize retention, and document the purpose.
5. Only claim a regional accent or dialect is supported after repeated listening tests by speakers from the relevant locality.

## Important limitation

Cadence, pronunciation, accent, latency, and prosody depend substantially on the selected speech model and its voice generation capabilities. Prompt changes can guide conversational style but cannot reliably manufacture a specific Assamese male or female accent. If the current model's Assamese speech remains unnatural, compare supported voices/models in controlled tests before considering a separate speech pipeline or fine-tuning where legally and technically available.
