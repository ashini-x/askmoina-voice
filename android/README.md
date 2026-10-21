# AskMoina Android shell — local wake experiment

This is the native Android adapter for the existing AskMoina web application, not a second product. It loads the authenticated AskMoina app at `https://askmoina-voice.thenewtongs.workers.dev/` by default; builds can override the endpoint with Gradle property `-PaskmoinaBaseUrl=https://your-approved-host/`.

## What it provides

- A WebView for the existing AskMoina sign-in, social-intelligence UI and camera assistant.
- A narrowly scoped JavaScript bridge available only while the top-level page is on the configured HTTPS origin.
- An explicit, user-started Android foreground microphone service that calls `SpeechRecognizer.createOnDeviceSpeechRecognizer` on Android 12+.
- Local matching of “Hey Moina”; no wake audio or wake transcript is sent to Gemini, and the service does not persist recognized text.
- A persistent notification while the user has enabled standby, with a Stop action.
- A partial CPU wake lock while screen-off operation is opted in. This may increase battery consumption and must be measured in the device pilot.
- A hand-off from native detection to the current AskMoina WebView Live client. The service stops its recognizer before notifying the WebView so the web microphone can acquire the audio input.

## Important limits

This is an engineering prototype. Android's on-device recognizer is general speech recognition, not a dedicated low-power keyword-spotting engine. Wake false-accept/false-reject and battery use are not yet characterized. It requires an on-device English recognizer to be present and available; if unavailable, it fails closed and does not fall back to cloud recognition.

The bridge sends the detected wake event to the existing WebView session. Real screen-off behaviour depends on Android device lifecycle, browser/WebView scheduling, Bluetooth routing and the live connection staying recoverable. Keep PR #366 in draft until this is tested on physical Android hardware with screen locked and earbuds connected.

## Build

- Android Studio or Android SDK with API 35 and Build Tools 35.0.0.
- JDK 17 and Gradle 8.13 or another compatible Gradle 8.x release.
- From the repository root: `gradle -p android assembleDebug`.
- Optional test endpoint: `gradle -p android assembleDebug -PaskmoinaBaseUrl=https://approved-preview-host/`.

The debug APK is produced at `android/app/build/outputs/apk/debug/app-debug.apk`. No signing credential is required for a debug build; this is not a Play Store release artifact.

## First device test

1. Install and open the debug APK while online, sign in to AskMoina, and open Social Intelligence.
2. Connect private earbuds, tick both privacy/participant-notice confirmations, and enable local wake-up while the app is visible.
3. Approve microphone permission. Keep the persistent AskMoina notification visible.
4. Say “Hey Moina” in English. Confirm the local recognizer stops before the Live client opens its microphone; then speak the request.
5. Return to standby, lock the screen, wait and repeat. Record wake delay, false wake, battery and session-reconnect observations.
6. Tap Stop standby in the notification and verify AskMoina disarms. Test Camera Assist afterward.

Do not test group conversations without giving participants appropriate notice. Do not treat voice matching as authentication.
