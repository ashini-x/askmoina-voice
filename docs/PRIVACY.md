# Privacy defaults

AskMoina streams microphone audio to Google Cloud Vertex AI only after the user presses **Start talking** and grants microphone permission. The current UI discloses this data flow before recording starts.

AskMoina does not save raw microphone audio or a persistent transcript archive by default. Transcript text received from the live model is displayed in the current page. It is not saved to the app's D1 analytics tables.

## Conversation history and Key Memories

Finalized user and assistant transcript text, rolling conversation summaries, and task state are saved to the signed-in account so the user can reopen prior sessions from History. Raw microphone audio and raw camera video are not saved as conversation history. The live Co-Pilot does not display user speech or assistant responses as transcripts or cards; conversation text is available when the user opens a saved conversation.

Reusable preferences the user states may be captured in account-scoped Key Memories. Users can review, edit, or delete these memories and pause preference learning. Conversation history is separate: pausing preference learning does not erase saved conversations.

When a new live session begins, AskMoina includes bounded recent summaries and excerpts from the account's conversation history as continuity context. When the user asks about a specific older detail that is not in current context, the Co-Pilot can search only that same account's saved turns. The complete archive is available in History; only a bounded amount can be placed in the model's active context at once, so old details may require an explicit history search.

## Identity and operational telemetry

The Worker issues a random first-party browser continuity token. Only a SHA-256 hash of the token is stored as a pseudonymous visitor identifier. It is an identifier for a browser profile, not proof of a real person's identity. IP hashes used by Durable Objects for rate limits are separate from this visitor ID.

The operations dashboard records session identifiers, pseudonymous visitor references, start/end timestamps, duration, outcome, model/location labels and setup success. It does not expose memories, microphone audio or conversation transcripts. Cost values are not fabricated from duration; actual spend should be sourced from Google Cloud billing reports.

Operational session records should be retained only for the configured analytics retention period and cleaned up accordingly. Admin login throttling stores a one-way hash of the client IP, not the raw address. The dashboard should be additionally protected with Cloudflare Access when feasible.

Google Cloud processes live audio and any selected context according to the configured provider and applicable service terms. Do not promise that this data is never processed or retained by the provider; verify the exact account configuration and current terms before making any zero-retention claim.

Any future memory extraction, conversation history, summary, account recovery, or cross-device linking feature needs clear consent, a documented purpose, retention limits, review/deletion behavior and a security assessment.
