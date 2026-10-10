# Experimental Gemini TTS voice-design benchmark

This is a non-production experiment. It does not change `src/index.ts`, Wrangler production configuration, or the deployed Vertex AI Live session path.

## What it compares

The script creates two prompted voice assets via the Gemini Enterprise Voices API, with the API's male gender setting:
- **A — Full acoustic prompt:** high-pitched, bright/light resonance, sweet/crisp/soft tone, gentle airy breathiness, no vocal fry or deep/gravelly resonance, warm and comforting.
- **B — Bright airy alternative:** a male speaking voice with exceptionally high pitch, bright lightweight resonance, sweet/crisp yet soft tone, gentle airy breathiness, warmth, and no deep or gravelly quality.

These candidates intentionally focus on acoustic characteristics rather than age or regional-language cues. Their Assamese speech clips test how the generated voice handles Assamese content; Upper Assamese naturalness still needs native-speaker listening. If one voice prompt fails to generate, the script records the error and continues with any successful candidate instead of losing all samples.

It generates:
- Assamese baseline speech with no turn-level style instruction.
- Assamese energetic speech using `speech_metadata.style` and inline `<short pause>` / `<chuckle>` tags.
- Assamese reassuring speech using a gentle style instruction.
- English control speech to compare perceived vocal character independently of Assamese-language limitations.
- One same-voice Gemini 3.8 Flash-Lite sample.
- One scripted, two-speaker Assamese TTS example.

The two voices are created with `store=true` and remain in the Google Cloud project to allow reuse. This uses billable Gemini TTS tokens. Use only the intended Google Cloud project and review its usage and billing settings before running. Each opt-in run creates fresh persisted voice assets, so repeat experiments may leave additional voice designs in the Google project.

## Run safely

The isolated GitHub Actions workflow is configured for `experiment/vertex-tts-voice-design-benchmark`, but GitHub only exposes manual dispatch when the workflow file is present on the repository's default branch. We intentionally keep this experiment off the production branch. To opt into billable generation, push a commit to this branch whose commit message contains `[run-benchmark]`. Ordinary pushes do not execute the billable benchmark job; do not merge this experiment into production just to expose the manual button.

The workflow requires a repository Actions secret named `GCP_SERVICE_ACCOUNT_JSON` containing a service-account JSON key with the required Vertex AI / Gemini Enterprise permissions. It reads `GCP_PROJECT_ID` from the checked-in `wrangler.jsonc` configuration for this isolated benchmark. The existing Cloudflare Worker secret cannot be read back into GitHub Actions. If the Actions secret is absent, the workflow stops before making Google API calls.

**Credential warning:** the repository is public. Prefer a dedicated least-privilege test service account, rather than the production key, for repeat experiments. Never paste a private key into repository files, workflow logs, issues, or chat. After a one-off test using a production key, remove the GitHub Actions secret and rotate the key if its exposure scope is no longer acceptable.

Alternatively, run `scripts/tts-voice-design-benchmark.py` locally in a Python environment already authenticated to the intended Google Cloud project (Application Default Credentials), with `GCP_PROJECT_ID` set and `google-genai>=2.25.0` installed.

Outputs are written to `tts-benchmark-output/` and include WAV files plus a JSON report containing voice IDs, per-request elapsed time, file duration/size, and API usage metadata where returned. The benchmark measures complete-response latency, not streaming first-audio latency.

## How to judge the result

Human-listen to the WAV files. Use a native Upper Assamese speaker to score:
1. Natural Upper Assamese pronunciation and regional cadence.
2. Perceived age / boyish quality, sweetness, and pitch.
3. Whether high-energy delivery sounds charming rather than shrill or cartoonish.
4. Laughter / pause placement and whether it sounds natural.
5. Whether the two-speaker version makes speaker changes clear.
6. Flash versus Flash-Lite naturalness and end-to-end generation time.

TTS Voice Design and style controls do not guarantee native Upper Assamese output. This benchmark is separate from the live microphone-to-audio path; passing it does not prove that replacing native Live output with TTS would preserve barge-in, latency, or conversational continuity.
