package com.askmoina.airfiberremote

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import androidx.core.content.ContextCompat
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.Closeable
import java.util.UUID

data class BluetoothRemoteState(
    val registered: Boolean = false,
    val connected: Boolean = false,
    val phoneBluetoothName: String = "",
    val peerName: String = "",
    val status: String = "BLE remote is not set up.",
    val error: String? = null
)

/**
 * Phone-side BLE HID over GATT (HOGP) keyboard/remote.
 *
 * Jio's published STB specifications describe the original RCU as a BLE HID
 * device using HOGP. This implementation advertises the HID service (0x1812)
 * and exposes standard keyboard and consumer-control input reports.
 */
class BluetoothHidRemote(context: Context) : Closeable {
    private val appContext = context.applicationContext
    private val manager = appContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    private val adapter: BluetoothAdapter? = manager?.adapter
    private val handler = Handler(Looper.getMainLooper())

    private var gattServer: BluetoothGattServer? = null
    private var advertiserStarted = false
    private var serviceAdded = false
    private var registered = false
    private var protocolMode: Byte = 0x01
    private val connectedDevices = linkedSetOf<BluetoothDevice>()
    private val keyboardSubscribers = linkedSetOf<BluetoothDevice>()
    private val consumerSubscribers = linkedSetOf<BluetoothDevice>()

    private val hidInfo = BluetoothGattCharacteristic(
        HID_INFORMATION_UUID,
        BluetoothGattCharacteristic.PROPERTY_READ,
        BluetoothGattCharacteristic.PERMISSION_READ
    ).apply { value = byteArrayOf(0x11, 0x01, 0x00, 0x02) }

    private val reportMap = BluetoothGattCharacteristic(
        REPORT_MAP_UUID,
        BluetoothGattCharacteristic.PROPERTY_READ,
        BluetoothGattCharacteristic.PERMISSION_READ
    ).apply { value = REPORT_DESCRIPTOR }

    private val controlPoint = BluetoothGattCharacteristic(
        HID_CONTROL_POINT_UUID,
        BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
        BluetoothGattCharacteristic.PERMISSION_WRITE
    )

    private val protocolModeCharacteristic = BluetoothGattCharacteristic(
        PROTOCOL_MODE_UUID,
        BluetoothGattCharacteristic.PROPERTY_READ or BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
        BluetoothGattCharacteristic.PERMISSION_READ or BluetoothGattCharacteristic.PERMISSION_WRITE
    ).apply { value = byteArrayOf(protocolMode) }

    private val keyboardReport = createInputReport(KEYBOARD_REPORT_ID, byteArrayOf(0, 0, 0, 0, 0, 0, 0, 0))
    private val consumerReport = createInputReport(CONSUMER_REPORT_ID, byteArrayOf(0, 0))

    private val _state = MutableStateFlow(BluetoothRemoteState())
    val state: StateFlow<BluetoothRemoteState> = _state.asStateFlow()

    private val gattCallback = object : BluetoothGattServerCallback() {
        override fun onServiceAdded(status: Int, service: BluetoothGattService) {
            if (service.uuid != HID_SERVICE_UUID) return
            if (status != BluetoothGatt.GATT_SUCCESS) {
                setError("Android could not add the BLE HID service (GATT status $status).")
                return
            }
            serviceAdded = true
            startAdvertising()
        }

        override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
            if (status == BluetoothGatt.GATT_SUCCESS && newState == BluetoothProfile.STATE_CONNECTED) {
                connectedDevices.add(device)
                _state.value = _state.value.copy(
                    registered = true,
                    connected = true,
                    peerName = safeDeviceName(device),
                    status = "BLE remote connected to " + safeDeviceName(device) + ".",
                    error = null
                )
            } else {
                connectedDevices.remove(device)
                keyboardSubscribers.remove(device)
                consumerSubscribers.remove(device)
                if (connectedDevices.isEmpty()) {
                    _state.value = _state.value.copy(
                        connected = false,
                        peerName = "",
                        status = if (registered) {
                            "BLE remote is advertising. Select this phone from the TV's Bluetooth accessories list."
                        } else {
                            "BLE remote disconnected."
                        }
                    )
                    if (registered) startAdvertising()
                }
            }
        }

        override fun onCharacteristicReadRequest(
            device: BluetoothDevice,
            requestId: Int,
            offset: Int,
            characteristic: BluetoothGattCharacteristic
        ) {
            val value = when (characteristic.uuid) {
                HID_INFORMATION_UUID -> hidInfo.value
                REPORT_MAP_UUID -> reportMap.value
                PROTOCOL_MODE_UUID -> byteArrayOf(protocolMode)
                KEYBOARD_REPORT_UUID -> keyboardReport.value
                CONSUMER_REPORT_UUID -> consumerReport.value
                else -> null
            }
            respondWithValue(device, requestId, offset, value)
        }

        override fun onDescriptorReadRequest(
            device: BluetoothDevice,
            requestId: Int,
            offset: Int,
            descriptor: BluetoothGattDescriptor
        ) {
            val value = when (descriptor.uuid) {
                REPORT_REFERENCE_UUID -> descriptor.value
                CLIENT_CONFIGURATION_UUID -> {
                    val enabled = when (descriptor.characteristic.uuid) {
                        KEYBOARD_REPORT_UUID -> keyboardSubscribers.contains(device)
                        CONSUMER_REPORT_UUID -> consumerSubscribers.contains(device)
                        else -> false
                    }
                    if (enabled) BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                    else BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE
                }
                else -> null
            }
            respondWithValue(device, requestId, offset, value)
        }

        override fun onDescriptorWriteRequest(
            device: BluetoothDevice,
            requestId: Int,
            descriptor: BluetoothGattDescriptor,
            preparedWrite: Boolean,
            responseNeeded: Boolean,
            offset: Int,
            value: ByteArray
        ) {
            if (offset != 0 || descriptor.uuid != CLIENT_CONFIGURATION_UUID) {
                if (responseNeeded) gattServer?.sendResponse(
                    device, requestId, BluetoothGatt.GATT_REQUEST_NOT_SUPPORTED, offset, null
                )
                return
            }
            val enabled = value.contentEquals(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
            when (descriptor.characteristic.uuid) {
                KEYBOARD_REPORT_UUID -> {
                    if (enabled) keyboardSubscribers.add(device) else keyboardSubscribers.remove(device)
                }
                CONSUMER_REPORT_UUID -> {
                    if (enabled) consumerSubscribers.add(device) else consumerSubscribers.remove(device)
                }
                else -> {
                    if (responseNeeded) gattServer?.sendResponse(
                        device, requestId, BluetoothGatt.GATT_REQUEST_NOT_SUPPORTED, offset, null
                    )
                    return
                }
            }
            descriptor.value = value
            if (responseNeeded) gattServer?.sendResponse(
                device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value
            )
        }

        override fun onCharacteristicWriteRequest(
            device: BluetoothDevice,
            requestId: Int,
            characteristic: BluetoothGattCharacteristic,
            preparedWrite: Boolean,
            responseNeeded: Boolean,
            offset: Int,
            value: ByteArray
        ) {
            val result = when (characteristic.uuid) {
                PROTOCOL_MODE_UUID -> {
                    if (offset == 0 && value.isNotEmpty() && value[0].toInt() in 0..1) {
                        protocolMode = value[0]
                        protocolModeCharacteristic.value = byteArrayOf(protocolMode)
                        BluetoothGatt.GATT_SUCCESS
                    } else BluetoothGatt.GATT_INVALID_ATTRIBUTE_LENGTH
                }
                HID_CONTROL_POINT_UUID -> {
                    if (offset == 0 && value.isNotEmpty()) BluetoothGatt.GATT_SUCCESS
                    else BluetoothGatt.GATT_INVALID_ATTRIBUTE_LENGTH
                }
                else -> BluetoothGatt.GATT_REQUEST_NOT_SUPPORTED
            }
            if (responseNeeded) gattServer?.sendResponse(device, requestId, result, offset, null)
        }
    }

    private val advertiseCallback = object : AdvertiseCallback() {
        override fun onStartSuccess(settingsInEffect: AdvertiseSettings) {
            advertiserStarted = true
            registered = true
            _state.value = _state.value.copy(
                registered = true,
                phoneBluetoothName = safeAdapterName(),
                status = "BLE HID remote is advertising. On the TV open Settings → Remote and Bluetooth → Add Bluetooth Accessories, then select this phone.",
                error = null
            )
        }

        override fun onStartFailure(errorCode: Int) {
            advertiserStarted = false
            registered = false
            val message = when (errorCode) {
                ADVERTISE_FAILED_DATA_TOO_LARGE -> "The BLE HID advertisement is too large for this phone."
                ADVERTISE_FAILED_TOO_MANY_ADVERTISERS -> "The phone's Bluetooth radio has no free BLE advertising slot. Close other Bluetooth-sharing apps and retry."
                ADVERTISE_FAILED_ALREADY_STARTED -> "BLE advertising is already running."
                ADVERTISE_FAILED_FEATURE_UNSUPPORTED -> "This phone does not support BLE peripheral advertising."
                ADVERTISE_FAILED_INTERNAL_ERROR -> "Android's Bluetooth service rejected BLE advertising (internal error)."
                else -> "BLE advertising failed (code $errorCode)."
            }
            setError(message)
        }
    }

    fun start() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) {
            setError("BLE remote mode requires Android 5 or newer.")
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
        if (registered && advertiserStarted) {
            _state.value = _state.value.copy(
                status = "BLE HID remote is advertising. Open Add Bluetooth Accessories on the TV and select " + safeAdapterName() + "."
            )
            return
        }
        val bleAdvertiser = runCatching { bluetoothAdapter.bluetoothLeAdvertiser }.getOrNull()
        if (bleAdvertiser == null) {
            setError("This phone does not support acting as a BLE peripheral. Its Bluetooth hardware/firmware does not expose BLE advertising.")
            return
        }
        if (gattServer == null) {
            val opened = runCatching { manager?.openGattServer(appContext, gattCallback) }.getOrNull()
            if (opened == null) {
                setError("Android could not open a BLE GATT server on this phone.")
                return
            }
            gattServer = opened
            serviceAdded = false
            _state.value = _state.value.copy(
                status = "Preparing the BLE HID service…",
                phoneBluetoothName = safeAdapterName(),
                error = null
            )
            val added = runCatching { opened.addService(buildHidService()) }.getOrDefault(false)
            if (!added) {
                setError("Android refused to register the BLE HID over GATT service.")
            }
        } else if (serviceAdded) {
            startAdvertising()
        }
    }

    private fun buildHidService(): BluetoothGattService {
        val service = BluetoothGattService(HID_SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY)
        service.addCharacteristic(hidInfo)
        service.addCharacteristic(reportMap)
        service.addCharacteristic(controlPoint)
        service.addCharacteristic(protocolModeCharacteristic)
        service.addCharacteristic(keyboardReport)
        service.addCharacteristic(consumerReport)
        return service
    }

    private fun createInputReport(reportId: Byte, initialValue: ByteArray): BluetoothGattCharacteristic {
        val characteristic = BluetoothGattCharacteristic(
            if (reportId == KEYBOARD_REPORT_ID) KEYBOARD_REPORT_UUID else CONSUMER_REPORT_UUID,
            BluetoothGattCharacteristic.PROPERTY_READ or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_READ
        )
        characteristic.value = initialValue
        val reference = BluetoothGattDescriptor(
            REPORT_REFERENCE_UUID,
            BluetoothGattDescriptor.PERMISSION_READ
        )
        reference.value = byteArrayOf(reportId, REPORT_TYPE_INPUT)
        characteristic.addDescriptor(reference)
        val cccd = BluetoothGattDescriptor(
            CLIENT_CONFIGURATION_UUID,
            BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE
        )
        cccd.value = BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE
        characteristic.addDescriptor(cccd)
        return characteristic
    }

    private fun startAdvertising() {
        if (!hasBluetoothPermissions()) {
            setError("Bluetooth permissions were removed. Allow Nearby devices and retry.")
            return
        }
        if (advertiserStarted) return
        val advertiser = runCatching { adapter?.bluetoothLeAdvertiser }.getOrNull()
        if (advertiser == null) {
            setError("This phone does not expose a BLE advertiser.")
            return
        }
        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .setConnectable(true)
            .setTimeout(0)
            .build()
        val data = AdvertiseData.Builder()
            .addServiceUuid(ParcelUuid(HID_SERVICE_UUID))
            .setIncludeDeviceName(true)
            .build()
        _state.value = _state.value.copy(
            status = "Advertising a BLE HID remote. Keep this app open and select the phone from the TV's Bluetooth list.",
            error = null
        )
        runCatching {
            advertiser.startAdvertising(settings, data, advertiseCallback)
        }.onFailure {
            setError("Could not start BLE advertising: " + (it.message ?: "Bluetooth error"))
        }
    }

    fun sendAndroidKey(keyCode: Int) {
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
            val data = byteArrayOf(
                (consumerUsage and 0xFF).toByte(),
                ((consumerUsage ushr 8) and 0xFF).toByte()
            )
            sendInputReport(consumerReport, consumerSubscribers, data)
            handler.postDelayed({
                sendInputReport(consumerReport, consumerSubscribers, byteArrayOf(0, 0))
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
        val report = ByteArray(8)
        report[2] = usage.toByte()
        sendInputReport(keyboardReport, keyboardSubscribers, report)
        handler.postDelayed({
            sendInputReport(keyboardReport, keyboardSubscribers, ByteArray(8))
        }, 90L)
    }

    private fun sendInputReport(
        characteristic: BluetoothGattCharacteristic,
        subscribers: Set<BluetoothDevice>,
        value: ByteArray
    ) {
        val server = gattServer ?: return
        val targets = subscribers.toList()
        targets.forEach { device ->
            runCatching {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    server.notifyCharacteristicChanged(device, characteristic, false, value)
                } else {
                    @Suppress("DEPRECATION")
                    run {
                        characteristic.value = value
                        server.notifyCharacteristicChanged(device, characteristic, false)
                    }
                }
            }
        }
    }

    private fun respondWithValue(
        device: BluetoothDevice,
        requestId: Int,
        offset: Int,
        value: ByteArray?
    ) {
        val server = gattServer ?: return
        if (value == null) {
            server.sendResponse(device, requestId, BluetoothGatt.GATT_REQUEST_NOT_SUPPORTED, offset, null)
            return
        }
        if (offset < 0 || offset > value.size) {
            server.sendResponse(device, requestId, BluetoothGatt.GATT_INVALID_OFFSET, offset, null)
            return
        }
        val part = value.copyOfRange(offset, value.size)
        server.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, part)
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
        val connect = ContextCompat.checkSelfPermission(
            appContext, Manifest.permission.BLUETOOTH_CONNECT
        ) == PackageManager.PERMISSION_GRANTED
        val advertise = ContextCompat.checkSelfPermission(
            appContext, Manifest.permission.BLUETOOTH_ADVERTISE
        ) == PackageManager.PERMISSION_GRANTED
        return connect && advertise
    }

    private fun setError(message: String) {
        _state.value = _state.value.copy(
            registered = false,
            error = message,
            status = message
        )
    }

    override fun close() {
        if (hasBluetoothPermissions()) {
            runCatching { adapter?.bluetoothLeAdvertiser?.stopAdvertising(advertiseCallback) }
        }
        advertiserStarted = false
        registered = false
        connectedDevices.clear()
        keyboardSubscribers.clear()
        consumerSubscribers.clear()
        runCatching { gattServer?.clearServices() }
        runCatching { gattServer?.close() }
        gattServer = null
        serviceAdded = false
    }

    companion object {
        private val HID_SERVICE_UUID: UUID = UUID.fromString("00001812-0000-1000-8000-00805f9b34fb")
        private val HID_INFORMATION_UUID: UUID = UUID.fromString("00002a4a-0000-1000-8000-00805f9b34fb")
        private val REPORT_MAP_UUID: UUID = UUID.fromString("00002a4b-0000-1000-8000-00805f9b34fb")
        private val HID_CONTROL_POINT_UUID: UUID = UUID.fromString("00002a4c-0000-1000-8000-00805f9b34fb")
        private val PROTOCOL_MODE_UUID: UUID = UUID.fromString("00002a4e-0000-1000-8000-00805f9b34fb")
        private val KEYBOARD_REPORT_UUID: UUID = UUID.fromString("00002a4d-0001-1000-8000-00805f9b34fb")
        private val CONSUMER_REPORT_UUID: UUID = UUID.fromString("00002a4d-0002-1000-8000-00805f9b34fb")
        private val REPORT_REFERENCE_UUID: UUID = UUID.fromString("00002908-0000-1000-8000-00805f9b34fb")
        private val CLIENT_CONFIGURATION_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

        private const val KEYBOARD_REPORT_ID: Byte = 0x01
        private const val CONSUMER_REPORT_ID: Byte = 0x02
        private const val REPORT_TYPE_INPUT: Byte = 0x01

        private val REPORT_DESCRIPTOR = byteArrayOf(
            // Generic Desktop / Keyboard, report ID 1.
            0x05, 0x01, 0x09, 0x06, 0xA1.toByte(), 0x01,
            0x85.toByte(), 0x01,
            0x05, 0x07, 0x19, 0xE0.toByte(), 0x29, 0xE7.toByte(),
            0x15, 0x00, 0x25, 0x01, 0x75, 0x01, 0x95.toByte(), 0x08,
            0x81.toByte(), 0x02,
            0x95.toByte(), 0x01, 0x75, 0x08, 0x81.toByte(), 0x01,
            0x95.toByte(), 0x06, 0x75, 0x08, 0x15, 0x00, 0x25, 0x65,
            0x05, 0x07, 0x19, 0x00, 0x29, 0x65, 0x81.toByte(), 0x00,
            0xC0.toByte(),
            // Consumer Control, report ID 2.
            0x05, 0x0C, 0x09, 0x01, 0xA1.toByte(), 0x01,
            0x85.toByte(), 0x02,
            0x15, 0x00, 0x26, 0xFF.toByte(), 0x03,
            0x19, 0x00, 0x2A, 0xFF.toByte(), 0x03,
            0x75, 0x10, 0x95.toByte(), 0x01, 0x81.toByte(), 0x00,
            0xC0.toByte()
        )
    }
}
