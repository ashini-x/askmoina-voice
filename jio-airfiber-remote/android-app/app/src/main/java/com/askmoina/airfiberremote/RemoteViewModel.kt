package com.askmoina.airfiberremote

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class CompanionStage {
    Setup, Finding, StartingPairing, AwaitingCode, Pairing, Connecting, Remote
}

data class RemoteUiState(
    val stage: CompanionStage = CompanionStage.Setup,
    val scanning: Boolean = false,
    val devices: List<TvDevice> = emptyList(),
    val manualHost: String = "",
    val currentHost: String = "",
    val deviceName: String = "Jio AirFiber set-top box",
    val pairedHost: String = "",
    val connected: Boolean = false,
    val bluetooth: BluetoothRemoteState = BluetoothRemoteState(),
    val code: String = "",
    val error: String? = null
)

class RemoteViewModel(app: Application) : AndroidViewModel(app) {
    private val preferences = app.getSharedPreferences("airfiber_remote_ui", 0)
    private val discovery = TvDiscovery(app)
    private val protocol = AtvRemoteV2(app)
    private val bluetooth = BluetoothHidRemote(app)

    private val _state = MutableStateFlow(RemoteUiState())
    val state: StateFlow<RemoteUiState> = _state.asStateFlow()

    init {
        val savedHost = preferences.getString("host", "").orEmpty()
        val savedName = preferences.getString("device_name", "Jio AirFiber set-top box")
            ?: "Jio AirFiber set-top box"
        _state.update {
            it.copy(
                pairedHost = savedHost,
                currentHost = savedHost,
                deviceName = savedName,
                stage = if (savedHost.isBlank()) CompanionStage.Finding else CompanionStage.Connecting
            )
        }
        viewModelScope.launch {
            bluetooth.state.collect { bluetoothState ->
                _state.update { it.copy(bluetooth = bluetoothState) }
            }
        }
        viewModelScope.launch {
            protocol.connected.collect { active ->
                _state.update { it.copy(connected = active) }
            }
        }
        viewModelScope.launch {
            protocol.lastError.collect { message ->
                if (!message.isNullOrBlank()) {
                    _state.update { current ->
                        current.copy(
                            error = message,
                            stage = if (current.pairedHost.isNotBlank()) CompanionStage.Remote else current.stage
                        )
                    }
                }
            }
        }

        if (savedHost.isBlank()) {
            scan()
        } else {
            viewModelScope.launch {
                val result = protocol.connect(savedHost)
                _state.update {
                    it.copy(
                        stage = CompanionStage.Remote,
                        error = result.exceptionOrNull()?.message
                    )
                }
            }
        }
    }

    fun scan() {
        if (_state.value.scanning) return
        viewModelScope.launch {
            _state.update {
                it.copy(
                    stage = if (it.pairedHost.isBlank()) CompanionStage.Finding else it.stage,
                    scanning = true,
                    devices = emptyList(),
                    error = null
                )
            }
            val devices = discovery.scan()
            val hasPairedDevice = _state.value.pairedHost.isNotBlank()
            _state.update {
                it.copy(
                    scanning = false,
                    devices = devices,
                    error = if (devices.isEmpty()) {
                        "No compatible TV remote service was found automatically. Check that your phone and set-top box use the same Wi-Fi."
                    } else null
                )
            }
            // For the common single-box home setup, skip the device picker and
            // start pairing directly. The TV's own code remains the approval step.
            if (devices.size == 1 && !hasPairedDevice) {
                startPairing(devices.first())
            }
        }
    }

    fun updateManualHost(value: String) {
        _state.update { it.copy(manualHost = value.take(64)) }
    }

    fun pairManualAddress() {
        val host = _state.value.manualHost.trim()
        if (host.isBlank()) {
            _state.update { it.copy(error = "Enter the TV's local IP address, or use Find my TV.") }
            return
        }
        startPairing(TvDevice(host, "Jio AirFiber set-top box"))
    }

    fun startPairing(device: TvDevice) {
        viewModelScope.launch {
            _state.update {
                it.copy(
                    stage = CompanionStage.StartingPairing,
                    currentHost = device.host,
                    deviceName = device.name,
                    code = "",
                    error = null
                )
            }
            val result = protocol.beginPairing(device.host)
            if (result.isSuccess) {
                _state.update { it.copy(stage = CompanionStage.AwaitingCode, error = null) }
            } else {
                _state.update {
                    it.copy(
                        stage = if (it.pairedHost.isNotBlank()) CompanionStage.Remote else CompanionStage.Setup,
                        error = result.exceptionOrNull()?.message
                            ?: "Could not start pairing with this TV."
                    )
                }
            }
        }
    }

    fun updateCode(value: String) {
        val clean = value.uppercase().filter { it in '0'..'9' || it in 'A'..'F' }.take(6)
        _state.update { it.copy(code = clean) }
    }

    fun submitCode() {
        val snapshot = _state.value
        if (snapshot.code.length != 6) {
            _state.update { it.copy(error = "Enter all six characters shown on the TV.") }
            return
        }

        viewModelScope.launch {
            _state.update { it.copy(stage = CompanionStage.Pairing, error = null) }
            val paired = protocol.finishPairing(snapshot.code)
            if (paired.isFailure) {
                _state.update {
                    it.copy(
                        stage = CompanionStage.AwaitingCode,
                        error = paired.exceptionOrNull()?.message ?: "Pairing was not accepted."
                    )
                }
                return@launch
            }

            preferences.edit()
                .putString("host", snapshot.currentHost)
                .putString("device_name", snapshot.deviceName)
                .apply()

            _state.update {
                it.copy(
                    pairedHost = snapshot.currentHost,
                    stage = CompanionStage.Connecting,
                    error = null
                )
            }
            val connection = protocol.connect(snapshot.currentHost)
            _state.update {
                it.copy(
                    stage = CompanionStage.Remote,
                    error = connection.exceptionOrNull()?.message
                )
            }
        }
    }

    fun reconnect() {
        val host = _state.value.pairedHost
        if (host.isBlank()) {
            scan()
            return
        }
        viewModelScope.launch {
            _state.update { it.copy(stage = CompanionStage.Connecting, error = null) }
            val result = protocol.connect(host)
            _state.update {
                it.copy(stage = CompanionStage.Remote, error = result.exceptionOrNull()?.message)
            }
        }
    }

    fun findAnotherTv() {
        protocol.clearSavedTv()
        preferences.edit().remove("host").remove("device_name").apply()
        _state.update {
            it.copy(
                stage = CompanionStage.Setup,
                pairedHost = "",
                currentHost = "",
                connected = false,
                devices = emptyList(),
                code = "",
                error = null
            )
        }
        scan()
    }

    fun startBluetoothRemote() {
        _state.update { it.copy(error = null, bluetooth = it.bluetooth.copy(error = null)) }
        bluetooth.start()
    }

    fun updateBluetoothError(message: String) {
        _state.update { it.copy(bluetooth = it.bluetooth.copy(error = message, status = message)) }
    }

    fun press(keyCode: Int) {
        if (_state.value.bluetooth.connected) bluetooth.sendAndroidKey(keyCode)
        else protocol.sendKey(keyCode)
    }

    fun launchApp(link: String) {
        if (_state.value.connected) protocol.launchApp(link)
    }

    override fun onCleared() {
        bluetooth.close()
        protocol.close()
        super.onCleared()
    }
}
