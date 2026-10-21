package com.askmoina.voice;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.util.Log;

import java.util.ArrayList;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Explicitly started, on-device wake detector. Standby recognition never sends
 * audio or transcripts to Gemini. This is general on-device speech recognition,
 * not a hardware low-power keyword engine; battery and false-trigger behaviour
 * must be measured on actual devices.
 */
public final class LocalWakeService extends Service {
    public static final String ACTION_START = "com.askmoina.voice.wake.START";
    public static final String ACTION_STOP_RECOGNITION = "com.askmoina.voice.wake.STOP_RECOGNITION";
    public static final String ACTION_STOP = "com.askmoina.voice.wake.STOP";
    public static final String ACTION_WAKE_DETECTED = "com.askmoina.voice.wake.DETECTED";
    public static final String ACTION_WAKE_ERROR = "com.askmoina.voice.wake.ERROR";
    public static final String ACTION_STOPPED_FROM_NOTIFICATION = "com.askmoina.voice.wake.STOPPED_FROM_NOTIFICATION";
    public static final String EXTRA_REASON = "reason";
    public static final String EXTRA_NOTIFY_STOP = "notify_stop";
    public static final String PREFS_NAME = "askmoina_native_wake";
    public static final String PREF_WAKE_PENDING = "wake_pending";
    private static final String TAG = "AskMoinaWake";
    private static final String CHANNEL_ID = "askmoina-local-wake";
    private static final int NOTIFICATION_ID = 7412;
    private static final Pattern WAKE_PATTERN = Pattern.compile("\\bhey\\s+moina\\b", Pattern.CASE_INSENSITIVE);

    private final Handler handler = new Handler(Looper.getMainLooper());
    private SpeechRecognizer recognizer;
    private PowerManager.WakeLock cpuWakeLock;
    private boolean standbyRequested;
    private boolean recognitionStarting;
    private boolean recognitionRunning;
    private boolean wakeDelivered;
    private boolean destroyed;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? ACTION_START : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            boolean notify = intent != null && intent.getBooleanExtra(EXTRA_NOTIFY_STOP, false);
            stopAll();
            if (notify) sendPackageBroadcast(ACTION_STOPPED_FROM_NOTIFICATION);
            stopSelf(startId);
            return START_NOT_STICKY;
        }
        if (ACTION_STOP_RECOGNITION.equals(action)) {
            standbyRequested = false;
            cancelRecognizer();
            updateNotification("Wake detector paused", "AskMoina is using the active live-session microphone.");
            return START_NOT_STICKY;
        }
        if (!ACTION_START.equals(action)) return START_NOT_STICKY;

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
                !SpeechRecognizer.isOnDeviceRecognitionAvailable(getApplicationContext())) {
            sendError("on_device_recognition_unavailable");
            stopSelf(startId);
            return START_NOT_STICKY;
        }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            sendError("microphone_permission_required");
            stopSelf(startId);
            return START_NOT_STICKY;
        }

        startForegroundCompat(buildNotification(
                "AskMoina local standby",
                "Wake phrase detection stays on this device. Standby audio is not sent to Gemini."));
        acquireCpuWakeLock();
        standbyRequested = true;
        wakeDelivered = false;
        startRecognizerWhenReady(100);
        return START_STICKY;
    }

    private void startForegroundCompat(Notification notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private void acquireCpuWakeLock() {
        if (cpuWakeLock != null && cpuWakeLock.isHeld()) return;
        PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
        if (powerManager == null) return;
        cpuWakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "AskMoina:LocalWake");
        cpuWakeLock.setReferenceCounted(false);
        cpuWakeLock.acquire();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "AskMoina local wake-up", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Visible status for explicitly enabled on-device wake detection.");
        channel.setShowBadge(false);
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.createNotificationChannel(channel);
    }

    private Notification buildNotification(String title, String message) {
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openPending = PendingIntent.getActivity(
                this, 7413, openIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent stopIntent = new Intent(this, LocalWakeService.class);
        stopIntent.setAction(ACTION_STOP);
        stopIntent.putExtra(EXTRA_NOTIFY_STOP, true);
        PendingIntent stopPending = PendingIntent.getService(
                this, 7414, stopIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);
        builder.setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentTitle(title)
                .setContentText(message)
                .setStyle(new Notification.BigTextStyle().bigText(message))
                .setContentIntent(openPending)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(Notification.CATEGORY_SERVICE)
                .addAction(new Notification.Action.Builder(
                        android.R.drawable.ic_media_pause, "Stop standby", stopPending).build());
        return builder.build();
    }

    private void updateNotification(String title, String message) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.notify(NOTIFICATION_ID, buildNotification(title, message));
    }

    private void startRecognizerWhenReady(long delayMs) {
        if (!standbyRequested || destroyed || wakeDelivered || recognitionStarting || recognitionRunning) return;
        handler.postDelayed(() -> {
            if (!standbyRequested || destroyed || wakeDelivered || recognitionStarting || recognitionRunning) return;
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                sendError("microphone_permission_required");
                stopAll();
                stopSelf();
                return;
            }
            if (!SpeechRecognizer.isOnDeviceRecognitionAvailable(getApplicationContext())) {
                sendError("on_device_recognition_unavailable");
                stopAll();
                stopSelf();
                return;
            }
            startRecognizer();
        }, Math.max(0, delayMs));
    }

    private void startRecognizer() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            sendError("on_device_recognition_unavailable");
            stopAll();
            stopSelf();
            return;
        }
        recognitionStarting = true;
        try {
            cancelRecognizer();
            recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(getApplicationContext());
            recognizer.setRecognitionListener(new RecognitionListener() {
                @Override public void onReadyForSpeech(Bundle params) {
                    recognitionStarting = false;
                    recognitionRunning = true;
                }

                @Override public void onBeginningOfSpeech() {}
                @Override public void onRmsChanged(float rmsdB) {}
                @Override public void onBufferReceived(byte[] buffer) {}
                @Override public void onEndOfSpeech() {
                    recognitionRunning = false;
                }

                @Override public void onError(int error) {
                    recognitionStarting = false;
                    recognitionRunning = false;
                    if (!standbyRequested || destroyed || wakeDelivered) return;
                    // No transcript is persisted. Retry transient recognizer end/error states locally.
                    if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
                        sendError("microphone_permission_required");
                        stopAll();
                        stopSelf();
                        return;
                    }
                    startRecognizerWhenReady(error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY ? 700 : 300);
                }

                @Override public void onResults(Bundle results) {
                    recognitionStarting = false;
                    recognitionRunning = false;
                    if (containsWakePhrase(results == null ? null :
                            results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION))) {
                        deliverWake();
                    } else {
                        startRecognizerWhenReady(180);
                    }
                }

                @Override public void onPartialResults(Bundle results) {
                    if (containsWakePhrase(results == null ? null :
                            results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION))) {
                        deliverWake();
                    }
                }

                @Override public void onEvent(int eventType, Bundle params) {}
            });

            Intent speechIntent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            speechIntent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            speechIntent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.US.toLanguageTag());
            speechIntent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            speechIntent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
            speechIntent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
            recognizer.startListening(speechIntent);
        } catch (SecurityException error) {
            recognitionStarting = false;
            recognitionRunning = false;
            sendError("microphone_permission_required");
            stopAll();
            stopSelf();
        } catch (RuntimeException error) {
            recognitionStarting = false;
            recognitionRunning = false;
            Log.w(TAG, "On-device recognizer failed to start", error);
            sendError("on_device_recognition_start_failed");
            stopAll();
            stopSelf();
        }
    }

    private boolean containsWakePhrase(ArrayList<String> alternatives) {
        if (alternatives == null) return false;
        for (String alternative : alternatives) {
            if (alternative == null) continue;
            String normalized = alternative.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", " ").trim();
            if (WAKE_PATTERN.matcher(normalized).find()) return true;
        }
        return false;
    }

    private void deliverWake() {
        if (wakeDelivered || !standbyRequested || destroyed) return;
        wakeDelivered = true;
        standbyRequested = false;
        cancelRecognizer();
        getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit()
                .putBoolean(PREF_WAKE_PENDING, true)
                .apply();
        updateNotification("AskMoina is waking", "Local wake detected. Opening the live conversation; standby audio was not sent to Gemini.");
        sendPackageBroadcast(ACTION_WAKE_DETECTED);
    }

    private void sendError(String reason) {
        Intent errorIntent = new Intent(ACTION_WAKE_ERROR);
        errorIntent.setPackage(getPackageName());
        errorIntent.putExtra(EXTRA_REASON, reason);
        sendBroadcast(errorIntent);
    }

    private void sendPackageBroadcast(String action) {
        Intent event = new Intent(action);
        event.setPackage(getPackageName());
        sendBroadcast(event);
    }

    private void cancelRecognizer() {
        SpeechRecognizer current = recognizer;
        recognizer = null;
        recognitionStarting = false;
        recognitionRunning = false;
        if (current != null) {
            try { current.cancel(); } catch (RuntimeException ignored) {}
            try { current.destroy(); } catch (RuntimeException ignored) {}
        }
    }

    private void stopAll() {
        standbyRequested = false;
        handler.removeCallbacksAndMessages(null);
        cancelRecognizer();
        if (cpuWakeLock != null && cpuWakeLock.isHeld()) {
            try { cpuWakeLock.release(); } catch (RuntimeException ignored) {}
        }
        cpuWakeLock = null;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.cancel(NOTIFICATION_ID);
    }

    @Override
    public void onDestroy() {
        destroyed = true;
        stopAll();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
