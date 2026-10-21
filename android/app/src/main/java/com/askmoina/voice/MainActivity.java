package com.askmoina.voice;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.SafeBrowsingResponse;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.media.AudioManager;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebViewClient;
import android.graphics.Color;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;

public final class MainActivity extends Activity {
    private static final int REQUEST_NATIVE_WAKE_MIC = 741;
    private static final int REQUEST_WEB_MEDIA = 742;
    public static final String ORIGIN_WAKE_DETECTED = LocalWakeService.ACTION_WAKE_DETECTED;
    private WebView webView;
    private PermissionRequest pendingWebPermission;
    private String[] pendingWebAndroidPermissions = new String[0];
    private boolean receiverRegistered;
    private boolean pageLoaded;
    private boolean pendingWakeEvent;
    private boolean nativeWakeForegroundActive;
    private AudioManager outputAudioManager;
    private AudioDeviceCallback outputDeviceCallback;

    private final BroadcastReceiver wakeReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            if (intent == null || intent.getAction() == null) return;
            switch (intent.getAction()) {
                case LocalWakeService.ACTION_WAKE_DETECTED:
                    pendingWakeEvent = true;
                    deliverPendingWakeIfReady();
                    break;
                case LocalWakeService.ACTION_WAKE_ERROR:
                    nativeWakeForegroundActive = false;
                    String reason = intent.getStringExtra(LocalWakeService.EXTRA_REASON);
                    evaluateJs("window.askMoinaNativeWakeError && window.askMoinaNativeWakeError(" +
                            jsString(reason == null ? "native_wake_error" : reason) + ")");
                    break;
                case LocalWakeService.ACTION_STOPPED_FROM_NOTIFICATION:
                    nativeWakeForegroundActive = false;
                    evaluateJs("window.askMoinaNativeWakeStoppedBySystem && window.askMoinaNativeWakeStoppedBySystem()");
                    break;
            }
        }
    };

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        configureSystemBars();
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(9, 10, 13));
        setContentView(webView);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSupportMultipleWindows(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) settings.setSafeBrowsingEnabled(true);

        webView.addJavascriptInterface(new NativeWakeBridge(), "AskMoinaNativeWake");
        webView.setWebViewClient(new TrustedOriginWebViewClient());
        webView.setWebChromeClient(new TrustedMediaChromeClient());
        registerWakeReceiver();
        registerAudioDeviceCallback();
        webView.loadUrl(BuildConfig.ASKMOINA_BASE_URL);
    }

    private void configureSystemBars() {
        Window window = getWindow();
        window.setStatusBarColor(Color.rgb(9, 10, 13));
        window.setNavigationBarColor(Color.rgb(9, 10, 13));
        window.getDecorView().setSystemUiVisibility(0);
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
    }

    private boolean isTrustedOrigin(Uri uri) {
        if (uri == null || !"https".equalsIgnoreCase(uri.getScheme())) return false;
        Uri base = Uri.parse(BuildConfig.ASKMOINA_BASE_URL);
        String host = uri.getHost();
        return host != null && host.equalsIgnoreCase(base.getHost()) &&
                (uri.getPort() == -1 || uri.getPort() == 443);
    }

    private void registerAudioDeviceCallback() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
        outputAudioManager = (AudioManager) getSystemService(AUDIO_SERVICE);
        if (outputAudioManager == null) return;
        outputDeviceCallback = new AudioDeviceCallback() {
            @Override public void onAudioDevicesAdded(AudioDeviceInfo[] addedDevices) {
                notifyWebOutputRouteChanged();
            }
            @Override public void onAudioDevicesRemoved(AudioDeviceInfo[] removedDevices) {
                notifyWebOutputRouteChanged();
            }
        };
        outputAudioManager.registerAudioDeviceCallback(outputDeviceCallback, new Handler(Looper.getMainLooper()));
    }

    private void notifyWebOutputRouteChanged() {
        evaluateJs("window.askMoinaNativeWakeAudioRouteChanged && window.askMoinaNativeWakeAudioRouteChanged()");
    }

    private void registerWakeReceiver() {
        IntentFilter filter = new IntentFilter();
        filter.addAction(LocalWakeService.ACTION_WAKE_DETECTED);
        filter.addAction(LocalWakeService.ACTION_WAKE_ERROR);
        filter.addAction(LocalWakeService.ACTION_STOPPED_FROM_NOTIFICATION);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(wakeReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(wakeReceiver, filter);
        }
        receiverRegistered = true;
    }

    private void evaluateJs(String expression) {
        if (webView == null) return;
        webView.post(() -> {
            if (webView != null) webView.evaluateJavascript(expression, null);
        });
    }

    private String jsString(String value) {
        String safe = value.replace("\\", "\\\\").replace("\"", "\\\"")
                .replace("\n", " ").replace("\r", " ");
        return "\"" + safe + "\"";
    }

    private void deliverPendingWakeIfReady() {
        if (!pendingWakeEvent || !pageLoaded || webView == null) return;
        evaluateJs("window.askMoinaNativeWakeDetected && window.askMoinaNativeWakeDetected()");
    }

    private void answerNativeWakePermission(boolean granted) {
        evaluateJs("window.__askMoinaNativeWakePermissionResult && window.__askMoinaNativeWakePermissionResult(" +
                (granted ? "true" : "false") + ")");
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
        boolean storedWake = getSharedPreferences(LocalWakeService.PREFS_NAME, MODE_PRIVATE)
                .getBoolean(LocalWakeService.PREF_WAKE_PENDING, false);
        if (storedWake) pendingWakeEvent = true;
        deliverPendingWakeIfReady();
    }

    @Override
    protected void onPause() {
        // While explicitly armed, keep the WebView's live JS client running so the
        // warm Gemini socket and native wake-to-live handoff can work with the screen off.
        // The foreground service owns microphone wake recognition and a partial CPU wake lock.
        if (webView != null && !nativeWakeForegroundActive) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        if (requestCode == REQUEST_NATIVE_WAKE_MIC) {
            boolean microphoneGranted = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
            boolean notificationsGranted = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                    checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
            answerNativeWakePermission(microphoneGranted && notificationsGranted);
            return;
        }
        if (requestCode == REQUEST_WEB_MEDIA) {
            PermissionRequest pending = pendingWebPermission;
            pendingWebPermission = null;
            boolean allGranted = grantResults.length > 0;
            for (int result : grantResults) allGranted &= result == PackageManager.PERMISSION_GRANTED;
            if (pending != null) {
                if (allGranted) grantTrustedWebResources(pending);
                else pending.deny();
            }
        }
    }

    private String[] requiredAndroidPermissions(PermissionRequest request) {
        List<String> required = new ArrayList<>();
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource) &&
                    checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                required.add(Manifest.permission.RECORD_AUDIO);
            }
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource) &&
                    checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                required.add(Manifest.permission.CAMERA);
            }
        }
        return required.toArray(new String[0]);
    }

    private void grantTrustedWebResources(PermissionRequest request) {
        if (request == null || !isTrustedOrigin(Uri.parse(request.getOrigin().toString()))) {
            if (request != null) request.deny();
            return;
        }
        List<String> grants = new ArrayList<>();
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource) &&
                    checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                grants.add(resource);
            } else if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource) &&
                    checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                grants.add(resource);
            }
        }
        if (grants.isEmpty()) request.deny();
        else request.grant(grants.toArray(new String[0]));
    }

    private final class NativeWakeBridge {
        @JavascriptInterface
        public boolean isSupported() {
            return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                    android.speech.SpeechRecognizer.isOnDeviceRecognitionAvailable(getApplicationContext());
        }

        @JavascriptInterface
        public void requestMicrophonePermission() {
            runOnUiThread(() -> {
                List<String> missing = new ArrayList<>();
                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                    missing.add(Manifest.permission.RECORD_AUDIO);
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                        checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                    missing.add(Manifest.permission.POST_NOTIFICATIONS);
                }
                if (missing.isEmpty()) {
                    answerNativeWakePermission(true);
                } else {
                    requestPermissions(missing.toArray(new String[0]), REQUEST_NATIVE_WAKE_MIC);
                }
            });
        }

        @JavascriptInterface
        public boolean startWakeDetector() {
            if (!isSupported() ||
                    checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                return false;
            }
            try {
                Intent intent = new Intent(MainActivity.this, LocalWakeService.class);
                intent.setAction(LocalWakeService.ACTION_START);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(intent);
                else startService(intent);
                nativeWakeForegroundActive = true;
                return true;
            } catch (RuntimeException error) {
                return false;
            }
        }

        @JavascriptInterface
        public void stopWakeRecognizer() {
            runOnUiThread(() -> {
                Intent intent = new Intent(MainActivity.this, LocalWakeService.class);
                intent.setAction(LocalWakeService.ACTION_STOP_RECOGNITION);
                startService(intent);
            });
        }

        @JavascriptInterface
        public void startWakeRecognizer() {
            runOnUiThread(() -> {
                Intent intent = new Intent(MainActivity.this, LocalWakeService.class);
                intent.setAction(LocalWakeService.ACTION_START);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(intent);
                else startService(intent);
            });
        }

        @JavascriptInterface
        public boolean isPrivateOutputAvailable() {
            android.media.AudioManager audioManager = (android.media.AudioManager) getSystemService(AUDIO_SERVICE);
            if (audioManager == null) return false;
            for (android.media.AudioDeviceInfo device : audioManager.getDevices(android.media.AudioManager.GET_DEVICES_OUTPUTS)) {
                switch (device.getType()) {
                    case android.media.AudioDeviceInfo.TYPE_WIRED_HEADPHONES:
                    case android.media.AudioDeviceInfo.TYPE_WIRED_HEADSET:
                    case android.media.AudioDeviceInfo.TYPE_USB_HEADSET:
                    case android.media.AudioDeviceInfo.TYPE_BLUETOOTH_A2DP:
                    case android.media.AudioDeviceInfo.TYPE_BLUETOOTH_SCO:
                    case android.media.AudioDeviceInfo.TYPE_BLE_HEADSET:
                    case android.media.AudioDeviceInfo.TYPE_HEARING_AID:
                        return true;
                    default:
                        break;
                }
            }
            return false;
        }

        @JavascriptInterface
        public void stopWakeService() {
            runOnUiThread(() -> {
                nativeWakeForegroundActive = false;
                stopService(new Intent(MainActivity.this, LocalWakeService.class));
            });
        }

        @JavascriptInterface
        public void acknowledgeWake() {
            getSharedPreferences(LocalWakeService.PREFS_NAME, MODE_PRIVATE).edit()
                    .putBoolean(LocalWakeService.PREF_WAKE_PENDING, false)
                    .apply();
            pendingWakeEvent = false;
        }
    }

    private final class TrustedOriginWebViewClient extends WebViewClient {
        @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (isTrustedOrigin(uri)) return false;
            // Never expose the JavaScript bridge to a third-party page.
            if (uri != null && "https".equalsIgnoreCase(uri.getScheme())) {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (RuntimeException ignored) {}
            }
            return true;
        }

        @Override public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            pageLoaded = isTrustedOrigin(Uri.parse(url));
            deliverPendingWakeIfReady();
        }
    }

    private final class TrustedMediaChromeClient extends WebChromeClient {
        @Override public void onPermissionRequest(PermissionRequest request) {
            runOnUiThread(() -> {
                if (request == null || !isTrustedOrigin(Uri.parse(request.getOrigin().toString()))) {
                    if (request != null) request.deny();
                    return;
                }
                String[] needed = requiredAndroidPermissions(request);
                if (needed.length == 0) {
                    grantTrustedWebResources(request);
                    return;
                }
                pendingWebPermission = request;
                pendingWebAndroidPermissions = needed;
                requestPermissions(needed, REQUEST_WEB_MEDIA);
            });
        }

        @Override public void onPermissionRequestCanceled(PermissionRequest request) {
            if (pendingWebPermission == request) pendingWebPermission = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (outputAudioManager != null && outputDeviceCallback != null) {
            try { outputAudioManager.unregisterAudioDeviceCallback(outputDeviceCallback); } catch (RuntimeException ignored) {}
            outputDeviceCallback = null;
            outputAudioManager = null;
        }
        if (receiverRegistered) {
            try { unregisterReceiver(wakeReceiver); } catch (RuntimeException ignored) {}
        }
        if (pendingWebPermission != null) {
            try { pendingWebPermission.deny(); } catch (RuntimeException ignored) {}
            pendingWebPermission = null;
        }
        if (isFinishing()) {
            try { stopService(new Intent(this, LocalWakeService.class)); } catch (RuntimeException ignored) {}
        }
        if (webView != null) {
            webView.removeJavascriptInterface("AskMoinaNativeWake");
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
