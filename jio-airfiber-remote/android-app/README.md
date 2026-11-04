# AirFiber Remote — Android companion

This is the beginner-friendly, native Android companion for the separately hosted Jio AirFiber remote PWA. It is isolated under this directory and does not change AskMoina Voice's production Worker.

## What it does

- Automatically searches the current Wi-Fi for devices advertising Android TV Remote Service v2.
- When exactly one compatible service is found, starts pairing directly instead of asking the user to enter an IP.
- Causes a compatible TV to show its one-time pairing code, asks for that code in the phone app, and stores the paired identity locally.
- Reconnects to the saved TV on subsequent launches.
- Provides D-pad, Back, Home, Power, Mute, volume, channel, YouTube and Netflix controls.
- Keeps the client identity and TV certificate fingerprint on the phone; no account, cloud database, ADB setup, bridge token or server is required for this protocol.

## Important compatibility limit

Jio's public support pages document the official Jio remote and Bluetooth accessory pairing, but do not confirm that every Jio AirFiber set-top box exposes Android TV Remote Service v2. The app therefore tests the service and reports a clear connection error when it is unavailable. It does not silently claim that a button worked. Real-device pairing and key-event tests are still required before calling this compatible with a particular Jio STB model.

The TV's standard pairing code is the approval step. This protocol does not always show an "Allow" popup: compatible Android TV devices display a code on their screen, and the user enters that code once on the phone. If the service is not exposed, this app cannot force the TV to show a permission prompt.

## Build

The GitHub Actions workflow builds an installable debug APK whenever this directory changes on the feature branch. It uploads a 30-day workflow artifact and publishes a preview APK release. See the repository's Releases page:

https://github.com/ashini-x/askmoina-voice/releases

For a local build, install JDK 17, Android SDK platform 35 and Gradle 8.9, then run this from the repository root:

    gradle -p jio-airfiber-remote/android-app assembleDebug

The APK is written to:

    jio-airfiber-remote/android-app/app/build/outputs/apk/debug/app-debug.apk

## Network and privacy

Discovery and commands stay on the phone's local network. The PWA Worker hosts only the browser interface; it is not in the native command path. This app does not collect or send TV addresses, pairing codes, certificates or button presses to a cloud API.

## Protocol notes

Android TV Remote v2 uses TLS on port 6467 for first-time pairing and port 6466 for commands. The handshake is based on the six-character code shown by the TV; after pairing, the TV trusts the app's client certificate. Compatibility varies by device and firmware.

This is an independent project and is not affiliated with Jio, Google, Netflix or YouTube.
