# Privacy defaults

AskMoina streams microphone audio to Google Cloud Vertex AI only after the user presses **Start talking** and grants microphone permission. The browser UI discloses this data flow before recording starts.

The AskMoina application does not save raw microphone audio by default. Audio frames are forwarded live to the configured Vertex AI Live session to produce replies. Text transcripts, if returned by the model, are displayed in the current page and are not persisted by this prototype. Clearing the on-page transcript removes it from the current view; refreshing or closing the page also clears the in-memory conversation display.

Google Cloud processes the audio as the configured model provider, subject to the user's Google Cloud and applicable service terms. Do not promise that data is never processed or retained by the provider; this repository only controls what AskMoina itself stores.

Any future transcript, summary, or memory feature needs a clear purpose, user control, retention period, and deletion behavior. Users should understand when the microphone is active, stop sessions, disable memory, and request deletion. Logs should contain the minimum information needed to debug reliability and cost. Do not market the product as a replacement for professional or emergency support.


## Memory vault (v0.4)

The optional memory vault is encrypted in the browser using AES-256-GCM. The passphrase-derived key is not transmitted to AskMoina. Device-only storage is the default; enabling cloud backup sends only an encrypted envelope, the vault locator, and an access token used to authorise backup updates. AskMoina stores only a one-way hash of the access token. The recovery kit contains the encrypted envelope and cloud access credential where applicable; keep it private, and keep the passphrase separate. Losing both the passphrase and a usable decrypted copy makes the memory unrecoverable.

A user can mark memories as eligible for sharing and must also enable the per-session “Include selected memories” checkbox. Approved context is sent to Google Cloud Vertex AI as part of the live-session setup. Therefore the vault is encrypted at rest and from the backup service, but context deliberately shared with Gemini is not end-to-end encrypted against the AI processing provider. Audio is streamed to the provider during the session. This prototype does not automatically transcribe, infer, or save long-term memories from conversation; users add and manage saved facts explicitly.

The dashboard records pseudonymous visitor identifiers, session timestamps, durations, outcomes, model/location and setup completion. It does not expose the vault table, raw audio, transcripts or decrypted memories. Pseudonymous visitor IDs identify a browser profile, not a verified person, and will not automatically follow a user across devices.
