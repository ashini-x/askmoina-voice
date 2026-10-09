# Privacy defaults

AskMoina streams microphone audio to Google Cloud Vertex AI only after the user presses **Start talking** and grants microphone permission. The browser UI discloses this data flow before recording starts.

The AskMoina application does not save raw microphone audio by default. Audio frames are forwarded live to the configured Vertex AI Live session to produce replies. Text transcripts, if returned by the model, are displayed in the current page and are not persisted by this prototype. Clearing the on-page transcript removes it from the current view; refreshing or closing the page also clears the in-memory conversation display.

Google Cloud processes the audio as the configured model provider, subject to the user's Google Cloud and applicable service terms. Do not promise that data is never processed or retained by the provider; this repository only controls what AskMoina itself stores.

Any future transcript, summary, or memory feature needs a clear purpose, user control, retention period, and deletion behavior. Users should understand when the microphone is active, stop sessions, disable memory, and request deletion. Logs should contain the minimum information needed to debug reliability and cost. Do not market the product as a replacement for professional or emergency support.
