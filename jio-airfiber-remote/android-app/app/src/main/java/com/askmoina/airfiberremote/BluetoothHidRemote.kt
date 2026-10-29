package com.askmoina.airfiberremote

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothHidDevice
import android.bluetooth.BluetoothHidDeviceAppSdpSettings
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.Closeable
import java.util.concurrent.Executor

data class BluetoothRemoteState(
    val registered: Boolean = false,
    val connected: Boolean = false,
    val phoneBluetoothName: String = "",
    val peerName: String = "",
    val status: String = "Bluetooth remote is not set up.",
    val error: String? = null
)

/**
 * Experimental alternative for boxes which accept a generic Bluetooth HID keyboard.
 * It does not depend on Android TV Remote Service ports 6466/6467.
 */
class BluetoothHidRemote(context: Context) : Closeable {
    private val appContext = context.applicationContext
    private val adapter: BluetoothAdapter? =
        (appContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
    private val mainHandler = Handler(Looper.getMainLooper())
    private var hid: BluetoothHidDevice? = null
    private var profileRequested = false
    private var registered = false
    private var peer: BluetoothDevice? = null

    private val _state = MutableStateFlow(BluetoothRemoteState())
    val state: StateFlow<BluetoothRemoteState> = _state.asStateFlow()

    private val executor = Executor { command -> mainHandler.post(command) }

    private val callback = object : BluetoothHidDevice.Callback() {
        override fun onAppStatusChanged(device: BluetoothDevice?, isRegistered: Boolean) {
            registered = isRegistered
            val name = safeAdapterName()
            _state.value = _state.value.copy(
                registered = isRegistered,
                phoneBluetoothName = name,
                status = if (isRegistered) {
                    "Bluetooth remote is ready. On the TV, open Settings → Remote & Bluetooth → Add Bluetooth Accessories, then select this phone: $name. Keep this app open."
                } else {
                    "Bluetooth remote registration stopped. Tap Set up Bluetooth remote to try again."
                },
                error = if (isRegistered) null else _state.value.error
            )
            if (isRegistered) {
                makeDiscoverable()
            }
        }

        override fun onConnectionStateChanged(device: BluetoothDevice, state: Int) {
            val connected = state == BluetoothProfile.STATE_CONNECTED
            if (connected) peer = device
            if (state == BluetoothProfile.STATE_DISCONNECTED && peer?.address == device.address) peer = null
            _state.value = _state.value.copy(
                connected = connected,
                peerName = if (connected) safeDeviceName(device) else "",
                status = if (connected) {
                    "Bluetooth remote connected to ${safeDeviceName(device)}."
                } else if (registered) {
                    "Ready for pairing. On the TV choose Settings → Remote & Bluetooth → Add Bluetooth Accessories."
                } else {
                    _state.value.status
                },
                error = null
            )
        }

        override fun onSetReport(device: BluetoothDevice, type: Byte, id: Byte, data: ByteArray) {
            runCatching {
                hid?.reportError(device, BluetoothHidDevice.ERROR_RSP_UNSUPPORTED_REQ)
            }
        }
    }

    fun start() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
            setError("Bluetooth HID remote mode requires Android 9 or newer.")
            return
        }
        if (!hasBluetoothPermissions()) {
            setError("Allow Nearby devices / Bluetooth permissions, then tap Set up Bluetooth remote again.")
            return
        }
        val bluetoothAdapter = adapter
        if (bluetoothAdapter == null) {
            setError("This phone does not have Bluetooth support.")
            return
        }
        if (!bluetoothAdapter.isEnabled) {
            setError("Turn Bluetooth on in your phone settings, then tap Set up Bluetooth remote again.")
            return
        }
        if (registered) {
            makeDiscoverable()
            return
        }
        if (profileRequested) return
        profileRequested = true
        _state.value = _state.value.copy(
            status = "Starting Bluetooth remote…",
            error = null,
            phoneBluetoothName = safeAdapterName()
        )
        val ok = runCatching {
            bluetoothAdapter.getProfileProxy(
                appContext,
                object : BluetoothProfile.ServiceListener {
                    override fun onServiceConnected(profile: Int, proxy: BluetoothProfile) {
                        profileRequested = false
                        if (profile != BluetoothProfile.HID_DEVICE) return
                        val deviceProxy = proxy as? BluetoothHidDevice
                        if (deviceProxy == null) {
                            setError("This phone does not expose the Bluetooth HID-device profile.")
                            return
                        }
                        hid = deviceProxy
                        val settings = BluetoothHidDeviceAppSdpSettings(
                            "AirFiber Remote",
                            "Phone remote for a TV or set-top box",
                            "AskMoina",
                            0x40.toByte(),
                            REPORT_DESCRIPTOR
                        )
                        val accepted = runCatching {
                            deviceProxy.registerApp(settings, null, null, executor, callback)
                        }.getOrDefault(false)
                        if (!accepted) {
                            setError("Android could not register the Bluetooth remote profile on this phone.")
                        } else {
                            _state.value = _state.value.copy(
                                phoneBluetoothName = safeAdapterName(),
                                status = "Registering Bluetooth remote… keep this app open."
                            )
                        }
                    }

                    override fun onServiceDisconnected(profile: Int) {
                        hid = null
                        registered = false
                        _state.value = _state.value.copy(
                            registered = false,
                            connected = false,
                            status = "Bluetooth service disconnected. Tap Set up Bluetooth remote to retry."
                        )
                    }
                },
                BluetoothProfile.HID_DEVICE
            )
        }.getOrDefault(false)
        if (!ok) {
            profileRequested = false
            setError("Android could not open Bluetooth HID-device mode. This phone may not support acting as a remote.")
        }
    }

    fun sendAndroidKey(keyCode: Int) {
        if (!hasBluetoothPermissions()) return
        val device = peer ?: runCatching {
            hid?.connectedDevices?.firstOrNull()
        }.getOrNull() ?: return
        val proxy = hid ?: return
        val consumerUsage = when (keyCode) {
            26 -> 0x0030 // Power
            164 -> 0x00E2 // Mute
            24 -> 0x00E9 // Volume increment
            25 -> 0x00EA // Volume decrement
            85 -> 0x00CD // Play/pause
            166 -> 0x009C // Channel increment
            167 -> 0x009D // Channel decrement
            else -> null
        }
        if (consumerUsage != null) {
            val down = byteArrayOf((consumerUsage and 0xFF).toByte(), ((consumerUsage ushr 8) and 0xFF).toByte())
            runCatching { proxy.sendReport(device, CONSUMER_REPORT_ID, down) }
            mainHandler.postDelayed({
                runCatching { proxy.sendReport(device, CONSUMER_REPORT_ID, byteArrayOf(0, 0)) }
            }, 90L)
            return
        }

        val usage = when (keyCode) {
            19 -> 0x52 // Up
            20 -> 0x51 // Down
            21 -> 0x50 // Left
            22 -> 0x4F // Right
            23 -> 0x28 // Enter / OK
            4 -> 0x29  // Escape / Back
            3 -> 0x4A  // Home
            82 -> 0x65 // Application / context menu
            else -> null
        } ?: return
        val keyReport = ByteArray(8)
        keyReport[2] = usage.toByte()
        runCatching { proxy.sendReport(device, KEYBOARD_REPORT_ID, keyReport) }
        mainHandler.postDelayed({
            runCatching { proxy.sendReport(device, KEYBOARD_REPORT_ID, ByteArray(8)) }
        }, 90L)
    }

    private fun makeDiscoverable() {
        if (!hasBluetoothPermissions()) return
        val bluetoothAdapter = adapter ?: return
        runCatching {
            bluetoothAdapter.setScanMode(BluetoothAdapter.SCAN_MODE_CONNECTABLE_DISCOVERABLE, DISCOVERABLE_SECONDS)
        }.onFailure {
            _state.value = _state.value.copy(
                status = "Bluetooth remote is registered, but Android could not make this phone discoverable.",
                error = "Open your phone's Bluetooth settings and enable visibility if it offers that option."
            )
        }
    }

    private fun safeAdapterName(): String {
        if (!hasBluetoothPermissions()) return "this phone"
        return runCatching { adapter?.name }.getOrNull().orEmpty().ifBlank { "this phone" }
    }

    private fun safeDeviceName(device: BluetoothDevice): String {
        if (!hasBluetoothPermissions()) return "TV / set-top box"
        return runCatching { device.name }.getOrNull().orEmpty().ifBlank { "TV / set-top box" }
    }

    private fun hasBluetoothPermissions(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
        val connect = ContextCompat.checkSelfPermission(appContext, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
        val advertise = ContextCompat.checkSelfPermission(appContext, Manifest.permission.BLUETOOTH_ADVERTISE) == PackageManager.PERMISSION_GRANTED
        return connect && advertise
    }

    private fun setError(message: String) {
        _state.value = _state.value.copy(error = message, status = message)
    }

    override fun close() {
        if (hasBluetoothPermissions()) runCatching { hid?.unregisterApp() }
        hid?.let { runCatching { adapter?.closeProfileProxy(BluetoothProfile.HID_DEVICE, it) } }
        hid = null
        peer = null
        registered = false
        profileRequested = false
    }

    companion object {
        private const val KEYBOARD_REPORT_ID = 1
        private const val CONSUMER_REPORT_ID = 2
        private const val DISCOVERABLE_SECONDS = 300

        private val REPORT_DESCRIPTOR = byteArrayOf(
            0x05, 0x01, 0x09, 0x06, 0xA1.toByte(), 0x01,
            0x85.toByte(), 0x01,
            0x05, 0x07, 0x19, 0xE0.toByte(), 0x29, 0xE7.toByte(), 0x15, 0x00, 0x25, 0x01,
            0x75, 0x01, 0x95.toByte(), 0x08, 0x81.toByte(), 0x02,
            0x95.toByte(), 0x01, 0x75, 0x08, 0x81.toByte(), 0x01,
            0x95.toByte(), 0x05, 0x75, 0x01, 0x05, 0x08, 0x19, 0x01, 0x29, 0x05,
            0x91.toByte(), 0x02,
            0x95.toByte(), 0x01, 0x75, 0x03, 0x91.toByte(), 0x01,
            0x95.toByte(), 0x06, 0x75, 0x08, 0x15, 0x00, 0x25, 0x65, 0x05, 0x07,
            0x19, 0x00, 0x29, 0x65, 0x81.toByte(), 0x00, 0xC0.toByte(),
            0x05, 0x0C, 0x09, 0x01, 0xA1.toByte(), 0x01,
            0x85.toByte(), 0x02,
            0x15, 0x00, 0x26, 0xFF.toByte(), 0x03, 0x19, 0x00, 0x2A, 0xFF.toByte(), 0x03,
            0x75, 0x10, 0x95.toByte(), 0x01, 0x81.toByte(), 0x00, 0xC0.toByte()
        )
    }
}
