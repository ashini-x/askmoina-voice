# Jio AirFiber Backup Remote

A separate static PWA under jio-airfiber-remote/ with its own Cloudflare Worker name, manifest, service worker, and local ADB bridge adapter. It does not bind to or change the AskMoina production Worker.

## Deploy the independent PWA Worker

From the repository root, install the repository dependencies if you have not already:

    npm install
    cd jio-airfiber-remote
    ../node_modules/.bin/wrangler deploy --config wrangler.jsonc

The Worker name is jio-airfiber-remote. Cloudflare will provide a dedicated workers.dev URL (or you can assign a dedicated custom hostname). This only hosts the PWA files; it cannot route a Cloudflare edge request directly into your private home Wi-Fi.

To test without deploying:

    cd jio-airfiber-remote
    ../node_modules/.bin/wrangler dev --config wrangler.jsonc

Install the PWA from the HTTPS Worker URL using your browser's install/add-to-home-screen option. Open it once while online so the app shell can be cached.

## Why the bridge is needed

A normal mobile browser cannot open a raw TCP socket to Android Debug Bridge (ADB) port 5555, and ADB is not a WebSocket service. The browser page therefore posts a narrow JSON request to this bridge, which runs the installed adb command against one allowlisted IP. There is no cloud database or command server in the PWA Worker.

The bridge deliberately allows only:
- One private IPv4 target (REMOTE_ALLOWED_IP)
- ADB TCP port 5555
- Android key codes 26, 164, 19, 20, 21, 22, 66, 4, 3, and 82
- Requests with a bearer token

The Jio box must actually support network ADB on port 5555 and must authorize the bridge host. This project does not unlock or enable ADB on a locked-down set-top box.

## Run the local bridge

Install Android Platform Tools (adb) on a computer that can reach the set-top box on the same Wi-Fi/LAN. Confirm that the box's private IP is stable and that ADB over TCP is enabled and authorized.

Set environment variables and start the bridge from this directory. Example for macOS/Linux:

    export REMOTE_ALLOWED_IP="192.168.1.100"  # replace with your box IP
    export REMOTE_TOKEN="$(openssl rand -hex 32)"
    export REMOTE_ALLOWED_ORIGIN="https://YOUR-WORKER.workers.dev"
    node bridge.mjs

Windows PowerShell equivalent:

    $env:REMOTE_ALLOWED_IP = "192.168.1.100"
    $env:REMOTE_TOKEN = "PASTE-A-LONG-RANDOM-SECRET-HERE"
    $env:REMOTE_ALLOWED_ORIGIN = "https://YOUR-WORKER.workers.dev"
    node .\bridge.mjs

Then test the box from that computer if required:

    adb connect 192.168.1.100:5555
    adb -s 192.168.1.100:5555 get-state

Replace the example address everywhere. Enter the box IP, bridge URL, and the same token in the PWA, then tap Test connection.

### Choose a bridge transport

**For testing from outside the LAN or when you need an easy HTTPS endpoint:** install cloudflared and start a temporary tunnel in another terminal:

    cloudflared tunnel --url http://127.0.0.1:8787

Enter the resulting HTTPS trycloudflare.com URL in the PWA. The temporary URL changes when the tunnel is restarted, and commands through the tunnel require internet access. Keep the token secret, restrict the allowed origin to your Worker URL, and never expose port 5555 itself.

**For operation when the building internet is down:** the bridge needs to remain reachable over the LAN through HTTPS with a certificate trusted by your phone. The bridge supports TLS via REMOTE_TLS_CERT and REMOTE_TLS_KEY; set REMOTE_LISTEN_HOST=0.0.0.0 only when you have configured trusted HTTPS and appropriate firewall rules. Use a certificate whose subject alternative name matches the bridge hostname/IP and install the issuing CA as trusted on the phone if needed. A plain HTTP URL is rejected by the PWA when loaded from HTTPS because browsers block mixed-content requests.

The service worker caches the remote interface shell, so the UI can still open offline. Key dispatch requires the local bridge and an authorized ADB connection to remain available.

## Security notes

- Do not expose ADB TCP port 5555 to the public internet.
- Do not commit your bridge token, certificates, or private IP as a secret.
- Bind the bridge to loopback by default. For LAN HTTPS mode, use firewall restrictions and a trusted certificate.
- The bridge token is stored in browser localStorage on the phone. Do not use it on a shared or untrusted device.
- If the Jio set-top box does not expose ADB over TCP, these browser and Worker files alone cannot control it; use an authorized LAN remote integration supported by the box instead.