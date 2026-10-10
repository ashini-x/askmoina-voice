# Upper Assam Assamese pronunciation: source audit and synthetic evaluation

**Review date:** 2026-10-10  
**Scope:** Sources discoverable on the public internet for a pronunciation-aware AskMoina Voice prototype. This is not a claim that any source has already improved Gemini Live audio.

## Findings

| Source | Public licence / access | Upper Assam coverage | Decision |
| --- | --- | --- | --- |
| [AI4Bharat IndicVoices](https://huggingface.co/datasets/ai4bharat/IndicVoices) | CC BY 4.0; Hugging Face requires an account and agreement to share contact information before dataset-file access. | The Assamese configuration exposes district, state and area metadata, so a subset may be filterable after access. The public card does not establish how many records are from Dibrugarh, Sivasagar, Jorhat or other Upper Assam districts. | Best next audio-corpus candidate. Not imported in this change because gated access has not been accepted and the regional sample counts have not been measured. The overall corpus is large, so start with a metadata-only district count and a small permitted sample. |
| [AI4Bharat Rasa expressive TTS dataset](https://huggingface.co/datasets/ai4bharat/Rasa) | CC BY 4.0; dataset files are gated behind sharing contact information. | Public card reports about 29 hours each for Assamese female and male speaker groups, but does not show Upper Assam district labels. It is an expressive TTS dataset, not an identified Upper Assam lexicon. | Potential later baseline for Assamese audio/model research; not evidence of a local accent and not used as if it were Upper Assam data. |
| [Upper Assam Assamese dialect-classifier model card](https://huggingface.co/dipankar53/assamese_dialect_classifier_model) | Model card declares MIT licence. It describes a classifier trained on 300 speech samples and lists Upper Assam among four dialect labels. | Region label is explicitly included in the task, but the model card is not a word-pronunciation dictionary and does not itself establish that the underlying 300 audio samples are downloadable and licensed for redistribution. | Useful research lead for future dialect auditing, not a pronunciation database and not imported into the Worker. |
| Appen Assamese Pronunciation Dictionary | The catalogue advertises an approximately 40,000-word resource, but a free redistribution licence was not established in this review. | Public catalogue information does not establish that it is Upper Assam-specific. | Excluded from the “free and reusable” seed. Revisit only if the licence and dialect metadata are clear. |
| Assamese phonology research | Public material includes [the Government of Assam/BIS Assamese script proposal](https://www.unicode.org/wg2/docs/n4947-Proposal_AssameseScript_ISO10646%20-%20V1.pdf) and Das & Deka's [study of allophonic variation in /x/](https://www.academia.edu/35777293/The_Allophonic_Variation_of_the_Assamese_voiceless_velar_fricative_x). | The paper discusses variation in Assamese varieties, including an Eastern Assamese word-initial [h] realization. It is linguistic evidence, not a district-balanced audio corpus. | Used to seed a small source-attributed rule reference, with regional entries marked unverified by Upper Assam listeners. |

## What is actually implemented in this prototype

- A Cloudflare D1 table called `assamese_pronunciation_rules`, with source title/URL, dialect and position scope, evidence status, priority, and an explicit `native_verified` flag.
- A small seed of five rules: the Assamese /x/ baseline associated with শ/ষ/স; a documented but conditional word-initial /x/ → [h] regional variant; a guard against extending that variant to every position; and two controls for English code-switching and inconsistent Romanized Assamese.
- At session setup, AskMoina appends a bounded excerpt of enabled rules to the existing Gemini Live system instruction. The lookup fails open: if the D1 migration is missing or the query fails, the existing voice session can still start.
- The seeded items intentionally have `native_verified = 0`. This is a research-grounded starting point, not a declaration that the exact variant is correct for every Upper Assam speaker.

## Synthetic test design and result interpretation

The automated synthetic tests cover seven rule behaviours:

1. Assamese-native শ/ষ/স should not default to English /s/.
2. Word-initial [h] is permitted as a conditional regional variant.
3. The published /xɔdai/ → [hɔdai] example must not be treated as universal.
4. The initial [h] pattern must not be globalized to every word position.
5. English /s/ in words such as “study”, “system” and “seriously” is a negative control.
6. Romanized Assamese must be interpreted by word identity and context, not raw letter substitution.
7. The system must disclose in its instructions that the seeded rules are not yet locally verified.

These tests evaluate database retrieval, prompt assembly, guardrails and graceful fallback. **They do not test a waveform, do not call Gemini Live, and cannot demonstrate an audible pronunciation improvement.** A real acoustic result needs target-dialect reference recordings and native-speaker listening/scoring (or a validated phonetic analysis), not just a successful deployment.

## Recommended next data step

After permissioned access to IndicVoices, query the Assamese metadata for Upper Assam districts first—such as Dibrugarh, Sivasagar, Jorhat, Tinsukia, Dhemaji, Lakhimpur and Charaideo—then inspect district counts, speaker diversity and licence/attribution requirements before downloading any audio. Do not assume that an Assamese record is Upper Assam merely because the language is Assamese. Build a tiny evaluation subset before considering bulk download or model changes.

For production quality, collect a small, consented set of native Upper Assam speakers reading target word lists and natural mixed-language sentences. Have at least two local reviewers agree on the word-level target pronunciation, keep disputed variants marked as variants, and compare the current Live output against that reference set. No voice recordings are bundled with this prototype.
