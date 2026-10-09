# Privacy defaults

AskMoina streams microphone audio to Google Cloud Vertex AI only after the user presses **Start talking** and grants microphone permission. The current UI discloses this data flow before recording starts.

AskMoina does not save raw microphone audio or a persistent transcript archive by default. Transcript text received from the live model is displayed in the current page. It is not saved to the app's D1 analytics tables.

## Memory Vault

The optional Memory Vault stores user-entered notes encrypted in the browser before persisting them in IndexedDB. The cloud backup option stores only encrypted ciphertext and cryptographic metadata. The recovery code is generated on the device and is never sent to AskMoina; if it is lost and no usable device copy remains, the vault cannot be recovered by the company.

Using saved context in a live conversation is a separate, explicit choice. When enabled, selected memory text is temporarily staged in the current browser tab and sent to Gemini with the next voice session's setup. Microphone audio and selected context are processed by Google Cloud Vertex AI. The encrypted-vault claim must not be represented as end-to-end encryption of the live AI session.

The initial release only saves the memories the user enters directly. It does not extract memories automatically from live speech. Local browser storage protects data at rest from the app's server, but does not protect an unlocked device from malware or malicious same-origin JavaScript.

## Identity and operational telemetry

The Worker issues a random first-party browser continuity token. Only a SHA-256 hash of the token is stored as a pseudonymous visitor identifier. It is an identifier for a browser profile, not proof of a real person's identity. IP hashes used by Durable Objects for rate limits are separate from this visitor ID.

The operations dashboard records session identifiers, pseudonymous visitor references, start/end timestamps, duration, outcome, model/location labels and setup success. It does not expose memories, microphone audio or conversation transcripts. Cost values are not fabricated from duration; actual spend should be sourced from Google Cloud billing reports.

Operational session records should be retained only for the configured analytics retention period and cleaned up accordingly. Admin login throttling stores a one-way hash of the client IP, not the raw address. The dashboard should be additionally protected with Cloudflare Access when feasible.

Google Cloud processes live audio and any selected context according to the configured provider and applicable service terms. Do not promise that this data is never processed or retained by the provider; verify the exact account configuration and current terms before making any zero-retention claim.

Any future memory extraction, conversation history, summary, account recovery, or cross-device linking feature needs clear consent, a documented purpose, retention limits, review/deletion behavior and a security assessment.
