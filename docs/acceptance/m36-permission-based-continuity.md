# M36 — Permission-based continuity

## Scope and implementation

- The encrypted Memory Vault remains separate from the live voice session; ordinary voice works with no saved memory.
- Browser memory use is opt-in. The consent marker askmoina.memory.consent.v1 allows an explicit opt-out to override stale per-tab sessionStorage.
- When enabled, the vault previews the bounded note text sent at new voice session setup. The cache is plaintext browser storage while enabled; the encrypted vault remains separate.
- Users can edit or delete individual notes, export an encrypted backup, lock the vault, or separately delete local/cloud encrypted backups.
- Turning memory off blocks injection into future setup messages and clears caches in other open tabs. It cannot retract context already sent to a connected Live session; end that conversation to clear that context.

## Synthetic acceptance

- [x] Initial consent is off and the preview makes the sharing state explicit.
- [x] Edit/save and delete controls operate on encrypted vault state and refresh future-session context only while opted in.
- [x] The cross-tab opt-out marker blocks stale sessionStorage fallback in the WebSocket setup wrapper.
- [x] Setup payloads include memory only when an allowed cache exists; server personalization stays optional.
- [x] TypeScript, client script tests, and production route smoke checks cover the consent path.

## Device acceptance still required

Use a disposable test vault. Save a preferred name, leave memory off and confirm a new session does not receive it; then opt in and confirm it reaches the assistant. Edit the note and verify the edited text appears in the next session. Opt out in one tab and start in another. For an already-connected session, end it after opting out because a context already sent at setup cannot be withdrawn.
