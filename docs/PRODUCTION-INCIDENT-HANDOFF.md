# AskMoina Voice — Production Incident Handoff

Last updated: 2026-10-16 UTC.

## Current status: Phase 1/2 speech gates passed; Phase 3 persistence passed live acceptance on 0.4.57; deferred synthetic failures remain

- Production checkpoint before Phase 3: `3ab61049137097ccd20b5f751bd26ae6f959823c`; Phase 3 persistence API merge: `6c81c739631c671b49cc2a6ed68f3eade0334ed6`.
- Production Worker before the follow-up: `0.4.54`. The first Phase 3 deployment workflow [run 38885100705](https://github.com/ashini-x/askmoina-voice/actions/runs/38885100705) stopped before Worker upload because the GitHub Actions token has Worker deployment permission but lacks D1 query permission (Cloudflare API error 7403).
- Through the separate authorized Cloudflare control plane, migration `0006_conversation_history.sql` was applied and schema verified. The `d1_migrations` tracking table was initialized with the six pre-existing migration filenames plus `0006`, after confirming their corresponding schemas were already present.
- Phase 3 merge sequence: API/schema PR #175 (`6c81c739631c671b49cc2a6ed68f3eade0334ed6`), live transcript integration PR #176 (`6978b004cfda76f1ed70149165deac8392f0dc5c`), nested transcription parser fix PR #177 (`c8bc6a99cfc3b5e25494bbf5707fe5ee50f769ea`).
- Production Worker `0.4.57` is healthy with the expected Gemini Live model and voice. Production health check [run 38900898335](https://github.com/ashini-x/askmoina-voice/actions/runs/38900898335) passed.
- The production audiovisual synthetic [run 38900898300](https://github.com/ashini-x/askmoina-voice/actions/runs/38900898300) recorded both `Production finalized transcript persistence: PASS` and `Production audiovisual Live recovery + continuity: PASS`. It also recorded `Synthetic conversation history: PASS`. A timeout in a post-acceptance stop-button click falsely caused the combined workflow to end red; the click was teardown, after all continuity and history assertions had passed. PR for best-effort teardown is in preparation on branch `phase-3/fix-smoke-cleanup-click`.
- Unrelated live-grounding, ranked-list/card fallback and voice-memory synthetic failures remain deferred by owner decision. They are tracked separately and are not evidence that the D1 owner-isolation or live transcript persistence gates failed.

## Evidence and diagnosis

The original 0.4.48 run [38782822842](https://github.com/ashini-x/askmoina-voice/actions/runs/38782822842) showed replay/resumption loops; the relay log noted provider close 1007 (“Untruncatable session”) and 1011 resource exhaustion after a large buffered replay burst. [PR #167](https://github.com/ashini-x/askmoina-voice/pull/167) addressed context compaction, paced replay and redundant recovery retries.

The 0.4.49 run [38785905379](https://github.com/ashini-x/askmoina-voice/actions/runs/38785905379) isolated the next defect: the real browser microphone sent thousands of PCM frames and local VAD detected speech, but no audio-end signal was sent. [PR #170](https://github.com/ashini-x/askmoina-voice/pull/170) added hybrid VAD's `audioStreamEnd` marker and deployed 0.4.50.

That change is necessary but not sufficient on its own. In [run 38787188368](https://github.com/ashini-x/askmoina-voice/actions/runs/38787188368), one post-boundary utterance received four new assistant audio frames. In the subsequent [run 38788316268](https://github.com/ashini-x/askmoina-voice/actions/runs/38788316268), the browser again sent one audio-end marker after VAD observed speech; the spoken turn received zero new audio frames while the same session answered the text control probe with three audio frames. Both runs reported no provider error or browser socket closure during the failed speech turn. The whole deployment workflow also failed on independent grounded-web-search verification; it must not be confused with the spoken-turn result.

Google documents a hybrid-VAD mode that keeps server VAD and sends `audioStreamEnd` when client VAD detects the end of speech. It warns that overly short endpointing thresholds split natural pauses. The browser currently ended its local gate after 240 ms of silence, making this a credible application-level endpointing defect—not evidence of a fixed two-minute provider limit. The relay already maps `audio_stream_end` to `realtimeInput.audioStreamEnd`. The Worker also has context-window compression and session resumption configured.

## Phase 1 fix merged and production verified (PR #171)

- Increase local speech-end tolerance from 240 ms to 700 ms, reducing premature finalization at natural phrase pauses.
- Explicitly configure automatic server VAD with 250 ms prefix padding and an 800 ms server-side silence fallback. Keep hybrid `audioStreamEnd` enabled; do not switch to manual VAD without evidence, because manual mode removes server prefix buffering and requires reliable client pre-roll.
- Bump the Worker/client release identifier to 0.4.51 and synchronize public and embedded Co-Pilot assets.
- Expand the production browser synthetic to use Chromium's actual `getUserMedia`/microphone PCM path beyond 155 seconds, then deliver two separate speech utterances. Require an end marker for each turn, fresh assistant audio and provider `turnComplete` for each reply on the same session. Keep socket/reconnect assertions strict; do not use text control input as a success condition.

## Verification records

- Merged Phase 1 commit: `d9a2ee82d31018a4b2d5ba414766a5fa803b1b05`.
- Deployed `0.4.51` Worker version: `e8fac2bf-5b23-4986-83f4-6e5b12eb2946` (confirmed by the deployment log and the successful retry health poll in [run 38793224730](https://github.com/ashini-x/askmoina-voice/actions/runs/38793224730)).
- First delayed spoken turn: `audioStreamEndFramesSent: 1`, `assistantAudioFramesReceived: 17`, provider turn completion observed.
- Second distinct delayed spoken turn: `audioStreamEndFramesSent: 1`, `assistantAudioFramesReceived: 29`, `completed: true`.
- Both turns passed after the 170-second silence window on one browser Live socket; no socket closure or provider error was recorded during the speech turn.
- Independent failure: the same full workflow failed `Synthetic live web grounding test` because the Live WebSocket closed during grounded search. Response-card, ranked-list, voice-memory, browser network-recovery and long-session speech synthetics passed.

## Phase 1 completion gate — satisfied

Phase 1 speech continuity is verified on deployed `0.4.51`: the production synthetic observed two delayed real-microphone turns, each producing fresh assistant audio and turn completion on the same session without a browser socket close or provider error. The unrelated web-grounding synthetic remains a separate issue and is not counted as a speech-continuity failure.

## Phase 2 — deterministic session recovery (candidate)

- PR: [#172 — Phase 2: Make Live session recovery deterministic](https://github.com/ashini-x/askmoina-voice/pull/172).
- Branch: `phase-2/deterministic-session-recovery`.
- Candidate release: `0.4.52`.
- The candidate gates resumed UI on real provider setup and replay completion; makes a pending attachment own the single relay socket slot; rejects duplicate concurrent reattachments; invalidates stale browser start promises; de-duplicates browser reconnect timers; and routes missing/expired handles to one explicit fresh-session path while closing stale provider sockets and clearing pending queues.
- New automated coverage includes delayed provider setup, duplicate reattachment, missing handle/setup, invalid/expired handle errors, provider-requested rotation during replay, and one forced browser network interruption followed by two required post-170-second spoken replies.
- Status at this handoff revision: PR validation and production recovery verification are still pending. Do not call Phase 2 complete until the browser-level forced-disconnect test passes after deployment and the following spoken turn produces assistant audio and completion, with no duplicate sockets or stuck status overlay.


## Phase 2 follow-up — replace silent provider after browser network loss

- Previous merged candidate: [PR #172](https://github.com/ashini-x/askmoina-voice/pull/172), commit `e2947f6107862be290ab2c37bc3f8b9b4050ba73`, deployed `0.4.52`.
- Production run [38804098966](https://github.com/ashini-x/askmoina-voice/actions/runs/38804098966) confirmed that the browser could recover its connection and UI with one socket and one `resumed` signal, but then failed the spoken turn after the 170-second delay: `audioStreamEndFramesSent: 1`, `assistantAudioFramesReceived: 0`. A text control probe on the same connection got two audio frames, with no provider errors.
- Root cause isolated in recovery policy: the browser's offline event closed with code 4001 (`Reconnect handoff`), which deliberately preserved the old upstream session. Reattaching the browser therefore mislabeled a still-audio-silent provider as recovered.
- Follow-up branch: `phase-2/fresh-provider-after-network-loss`; candidate release `0.4.53`. Explicit browser offline now closes the old socket with code 4002, which the relay treats as termination rather than handoff. The user-requested Reconnect action then creates a new session UUID and starts one fresh provider session while keeping local camera preview available.
- The production synthetic was changed to require zero `resuming`/`resumed` signals for this explicit replacement path, exactly one live browser socket after reconnect, clear preview/recovery UI, and two real microphone turns after the 170-second delay, each with fresh assistant audio and provider `turnComplete`.
- Status at this candidate revision: PR validation, deployment and production spoken-turn verification remain pending. Phase 2 is not complete until the new deployed synthetic passes; the earlier `0.4.52` UI-only recovery pass does not meet the audio requirement.


## Phase 2 audio-turn follow-up — explicit client VAD candidate `0.4.54`

- The fresh-session change is verified at the transport/UI level, but production run [38806059263](https://github.com/ashini-x/askmoina-voice/actions/runs/38806059263) still showed no new assistant audio for the delayed microphone utterance after network replacement. It recorded the client audio-end marker; a text probe still received audio and the provider reported no error.
- This confirms the outstanding issue is broader than session reattachment. The browser streamed more than two minutes of silence into an automatically detected audio stream and depended on a hybrid end marker, which was not reliably committing the delayed speech turn.
- Candidate branch: `phase-2/deterministic-audio-activity`, release `0.4.54`.
- Co-Pilot now keeps a bounded ~300 ms PCM pre-roll locally; while idle it sends no silence-only PCM. On voice onset it sends `activityStart`, flushes pre-roll, and streams PCM; after sustained local VAD silence it sends the final PCM frame and `activityEnd`. Provider setup disables automatic activity detection, as required by this explicit activity-boundary protocol. The continuity synthetic checks both activity markers and requires two fresh assistant-audio replies with `turnComplete` after the long pause.
- The deterministic reconnect fixes from PRs #172 and #173 remain in place. No D1 history or Continue button was added.
- Production verification: deployed release `0.4.54` is reported healthy; run [38809174681](https://github.com/ashini-x/askmoina-voice/actions/runs/38809174681) explicitly recorded `Production audiovisual Live recovery + continuity: PASS`, with one live browser socket after recovery and two completed post-170-second spoken turns with fresh assistant audio. The full workflow conclusion is still failure only because independent web-grounding, response-card and voice-memory checks failed. Phase 1 and Phase 2 exit criteria for speech continuity and forced recovery are considered met.


## Phase 3 verification follow-up — nested Live transcription parsing

- Deployed `0.4.56` had a healthy Worker and passing direct authenticated history API smoke, but the real-microphone transcript persistence check failed because nested Gemini Live `serverContent.inputTranscription` / `outputTranscription` camelCase fields were not read by the browser parser.
- [PR #177](https://github.com/ashini-x/askmoina-voice/pull/177), merged as `c8bc6a99cfc3b5e25494bbf5707fe5ee50f769ea`, fixed the browser parser to accept nested camelCase and snake_case frames, synchronized embedded assets, and added parser regression coverage. Deployed candidate release is `0.4.57`.
- In production [run 38900898300](https://github.com/ashini-x/askmoina-voice/actions/runs/38900898300), the browser synthetic emitted:
  - `Production finalized transcript persistence: PASS`: a real browser microphone user turn, assistant reply, summary and non-empty task goal were saved in D1 without logging transcript text.
  - `Production audiovisual Live recovery + continuity: PASS`: forced browser network loss, exactly one recovered socket, two completed post-170-second spoken turns with fresh assistant audio, stable live UI and no stale reconnect notice.
  - `Synthetic conversation history: PASS`: authenticated API create/read/append, order, idempotent retry, summary/task restore, cross-user denial, archive and delete.
- The overall deployment workflow still ended `failure` for separate grounding/ranked-list/voice-memory synthetic failures that the owner has explicitly deferred, plus a Playwright timeout during the final stop-button teardown **after** the continuity synthetic printed PASS. This teardown was not part of the acceptance criteria and is being made best-effort in branch `phase-3/fix-smoke-cleanup-click`.
- The production migration `0006_conversation_history.sql` and Wrangler `d1_migrations` records are present. Because the GitHub deployment token lacks D1 API permission (Cloudflare error 7403), migrations must be applied and verified through the authorized Cloudflare control plane before any future Worker that requires new schema is promoted.
- Status: Phase 3 persistence/owner-isolation and actual microphone transcript acceptance have passed against deployed `0.4.57`. The remaining full-workflow red checks are listed above and are intentionally deferred; the final smoke cleanup fix is test-only and does not change the Worker release.

## Phase 3 — persistent conversation history (deployed and live acceptance passed)

- API/schema PR: [#175 — Phase 3: Add secure persistent conversation history](https://github.com/ashini-x/askmoina-voice/pull/175), merged as `6c81c739631c671b49cc2a6ed68f3eade0334ed6`.
- Browser integration PR [#176](https://github.com/ashini-x/askmoina-voice/pull/176) and parser-fix PR [#177](https://github.com/ashini-x/askmoina-voice/pull/177) are merged; deployed release `0.4.57`.
- D1 schema: `conversations` is owned by authenticated `account_users.user_id` and stores a title, compact summary, bounded JSON task progress, active/archived status and timestamps. `conversation_turns` stores only finalized user/assistant text with server IDs, sequence numbers and per-conversation idempotency keys. Composite foreign keys and owner/order indexes enforce ownership and deletion.
- APIs: `GET/POST /api/conversations`, `GET/PATCH/DELETE /api/conversations/:id`, and `POST /api/conversations/:id/turns`. Reads and writes are owner-scoped; writes require same-origin requests; body/content limits are enforced; conflicting idempotency-key reuse returns 409.
- Browser integration: real finalized transcripts now enqueue owner-scoped turns in order, attach compact summary/task progress to assistant turns, retry transient append errors with the same idempotency key, and fail open so D1 errors do not stop live voice. The first-call greeting alone is not stored. A new manual topic gets a new conversation scope; automatic reconnect keeps the same scope.
- Retention/privacy: history remains until owner deletion or account deletion. Analytics cleanup does not delete conversation history. Conversation deletion cascades to turns. Raw audio/video, live sockets, resume handles and replay buffers are not stored in D1.
- Migration rollout: migration 0006 and its Wrangler filename tracking are verified on production via the authorized Cloudflare control plane. The GitHub deployment token lacks D1 API permission (Cloudflare code 7403), so remote migration application was removed from the Worker deploy workflow; do not add a pending D1 migration without applying/verifying it through an authorized migration process first.
- Production acceptance includes the disposable-account direct API smoke and the real-microphone continuity synthetic that verifies saved user/assistant turns, summary and task goal without printing transcript text. Both passed on `0.4.57`.
- Phase 3 acceptance is met for persistent history, account isolation, idempotent ordered turns, summary/task restoration, deletion and real-browser microphone transcription. The aggregate workflow remains red only for previously deferred live grounding/ranked-list/voice-memory tests and a post-pass teardown timeout; branch `phase-3/fix-smoke-cleanup-click` makes that final stop-button teardown best-effort without lowering acceptance assertions.


## Phase 4 — Apple-style History and Key Memories (implementation branch; not yet deployed)

- Feature PR: [#179 — Apple-style conversation history and persistent Key Memories](https://github.com/ashini-x/askmoina-voice/pull/179).
- Browser assets add a compact History control above the camera and a responsive Library sheet: searchable conversations; saved transcript, summary and task context; archive/restore/delete; Continue with Moina; and a Key Memories editor with pause, edit, delete and clear-all controls.
- Resuming a conversation loads its full transcript through bounded pages for display, restores task progress, reuses the original conversation ID for future saved turns, and passes a bounded summary/task/recent-transcript context to the next Gemini Live session. The model prompt is bounded for latency and provider context limits; the full transcript remains available in History.
- New user-memory API and migration 0007_user_memories.sql add account-scoped memory settings and reusable interaction preferences, separate from transcript records. Only direct, reusable preference statements are automatically captured; one-off commands and obvious sensitive disclosures/credentials are excluded. Users can turn learning off, edit or delete memories, or clear all. New memory tables store text, not raw video or microphone audio. Guest access remains disabled.
- The live history synthetic now checks account isolation, automatic preference capture, memory-off behavior, manual create/edit/delete, and presence of the authenticated Library UI.
- **Release gate:** 0007 has not yet been applied to production in this branch. Apply and verify its schema through the authorized Cloudflare control plane and record 0007_user_memories.sql in d1_migrations before merging/promoting the Worker. The GitHub deployment token cannot perform D1 migrations (Cloudflare error 7403). This branch is not live production yet.
