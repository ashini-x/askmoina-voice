package com.askmoina.airfiberremote

import android.Manifest
import android.app.Activity
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle

class MainActivity : ComponentActivity() {
    private val viewModel: RemoteViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            val palette = darkColorScheme(
                primary = Mint,
                onPrimary = Color(0xFF08201F),
                secondary = Color(0xFF9DB8D8),
                background = Color(0xFF0B1220),
                surface = Color(0xFF111D32),
                onBackground = Color(0xFFEEF4FF),
                onSurface = Color(0xFFEEF4FF),
                error = Color(0xFFFF8F9C)
            )
            MaterialTheme(colorScheme = palette) {
                Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    AirFiberRoot(viewModel)
                }
            }
        }
    }
}

private val Mint = Color(0xFF73E0D0)
private val Panel = Color(0xFF111D32)
private val SoftText = Color(0xFF9CAFC9)
private val KeyBackground = Color(0xFF1A2B44)
private const val NETFLIX_URL = "https://www.netflix.com/title"
private const val YOUTUBE_URL = "https://www.youtube.com"

private object TvKeys {
    const val POWER = 26
    const val MUTE = 164
    const val UP = 19
    const val DOWN = 20
    const val LEFT = 21
    const val RIGHT = 22
    const val OK = 23
    const val BACK = 4
    const val HOME = 3
    const val MENU = 82
    const val VOLUME_UP = 24
    const val VOLUME_DOWN = 25
    const val CHANNEL_UP = 166
    const val CHANNEL_DOWN = 167
    const val PLAY_PAUSE = 85
}

@Composable
private fun AirFiberRoot(viewModel: RemoteViewModel) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 24.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Surface(
                modifier = Modifier.size(48.dp),
                shape = RoundedCornerShape(16.dp),
                color = Color(0xFF18334A)
            ) {
                androidx.compose.foundation.layout.Box(contentAlignment = Alignment.Center) {
                    Text("⌁", color = Mint, fontSize = 29.sp, fontWeight = FontWeight.Light)
                }
            }
            Spacer(Modifier.width(13.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text("AirFiber Remote", fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
                Text("A simple backup for your set-top box", fontSize = 12.sp, color = SoftText)
            }
        }

        if (state.pairedHost.isNotBlank() || state.bluetooth.connected) {
            RemotePanel(
                state = state,
                onKey = viewModel::press,
                onLaunch = viewModel::launchApp,
                onReconnect = viewModel::reconnect,
                onFindAnother = viewModel::findAnotherTv
            )
        } else {
            PairingPanel(
                state = state,
                onScan = viewModel::scan,
                onPairDevice = viewModel::startPairing,
                onManualHostChange = viewModel::updateManualHost,
                onPairManual = viewModel::pairManualAddress,
                onCodeChange = viewModel::updateCode,
                onSubmitCode = viewModel::submitCode,
                onStartBluetooth = viewModel::startBluetoothRemote,
                onBluetoothError = viewModel::updateBluetoothError
            )
        }

        Text(
            if (state.bluetooth.connected) "Bluetooth remote is connected. Some keys depend on how the set-top box handles generic Bluetooth keyboards." else "Wi-Fi pairing requires Android TV Remote Service. If the box refuses that connection, try the Bluetooth remote option.",
            fontSize = 11.sp,
            color = SoftText,
            lineHeight = 16.sp,
            modifier = Modifier.padding(horizontal = 2.dp)
        )
    }
}

@Composable
private fun PairingPanel(
    state: RemoteUiState,
    onScan: () -> Unit,
    onPairDevice: (TvDevice) -> Unit,
    onManualHostChange: (String) -> Unit,
    onPairManual: () -> Unit,
    onCodeChange: (String) -> Unit,
    onSubmitCode: () -> Unit,
    onStartBluetooth: () -> Unit,
    onBluetoothError: (String) -> Unit
) {
    val context = LocalContext.current
    val enableBluetoothLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == Activity.RESULT_OK) onStartBluetooth()
        else onBluetoothError("Turn Bluetooth on to try the Bluetooth remote.")
    }
    val bluetoothPermissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { permissions ->
        if (permissions.values.all { it }) {
            val adapter = (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
            when {
                adapter == null -> onBluetoothError("This phone does not have Bluetooth support.")
                !adapter.isEnabled -> enableBluetoothLauncher.launch(Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE))
                else -> onStartBluetooth()
            }
        } else {
            onBluetoothError("Allow the Nearby devices / Bluetooth permissions, then tap Set up Bluetooth remote again.")
        }
    }
    fun requestBluetoothSetup() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            bluetoothPermissionLauncher.launch(arrayOf(Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_ADVERTISE))
        } else {
            val adapter = (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
            when {
                adapter == null -> onBluetoothError("This phone does not have Bluetooth support.")
                !adapter.isEnabled -> enableBluetoothLauncher.launch(Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE))
                else -> onStartBluetooth()
            }
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        PanelCard {
            Text("Connect to your TV", fontSize = 19.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(5.dp))
            Text(
                "Keep the TV on and your phone on the same Wi-Fi. AirFiber Remote will look for it automatically.",
                color = SoftText,
                fontSize = 13.sp,
                lineHeight = 19.sp
            )
            Spacer(Modifier.height(14.dp))
            Button(
                onClick = onScan,
                enabled = !state.scanning && state.stage != CompanionStage.StartingPairing,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = Mint, contentColor = Color(0xFF08201F))
            ) {
                if (state.scanning) {
                    CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp, color = Color(0xFF08201F))
                    Spacer(Modifier.width(9.dp))
                    Text("Looking for your TV…")
                } else {
                    Text("Find my TV")
                }
            }

            if (state.scanning || state.stage == CompanionStage.Finding) {
                Spacer(Modifier.height(8.dp))
                Text("Searching your Wi-Fi network", fontSize = 12.sp, color = SoftText)
            }

            if (state.devices.size > 1) {
                Spacer(Modifier.height(12.dp))
                Text("Choose your TV", fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                state.devices.forEach { device ->
                    Button(
                        onClick = { onPairDevice(device) },
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.buttonColors(containerColor = KeyBackground)
                    ) {
                        Text(device.name + "  ·  " + device.host, textAlign = TextAlign.Center)
                    }
                }
            }
        }

        PanelCard {
            Text("Try Bluetooth remote", fontSize = 19.sp, fontWeight = FontWeight.SemiBold)
            Text(
                "This uses your phone as a generic Bluetooth keyboard/remote instead of the Wi-Fi service your box refused. Compatibility still depends on the box and phone.",
                color = SoftText, fontSize = 12.sp, lineHeight = 18.sp
            )
            Spacer(Modifier.height(8.dp))
            Button(
                onClick = { requestBluetoothSetup() },
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = Mint, contentColor = Color(0xFF08201F))
            ) { Text(if (state.bluetooth.registered) "Refresh Bluetooth remote" else "Set up Bluetooth remote") }
            Spacer(Modifier.height(8.dp))
            Text(state.bluetooth.status, color = SoftText, fontSize = 12.sp, lineHeight = 18.sp)
            if (state.bluetooth.registered) {
                Spacer(Modifier.height(6.dp))
                Text(
                    "Next on the TV: Settings → Remote & Bluetooth → Add Bluetooth Accessories. Select your phone (${state.bluetooth.phoneBluetoothName}) and pair it. Keep this app open.",
                    color = SoftText, fontSize = 12.sp, lineHeight = 18.sp
                )
            }
            state.bluetooth.error?.let { ErrorCard(it) }
        }

        if (state.stage == CompanionStage.StartingPairing || state.stage == CompanionStage.Pairing ||
            state.stage == CompanionStage.Connecting) {
            PanelCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp, color = Mint)
                    Spacer(Modifier.width(12.dp))
                    Column {
                        Text(
                            when (state.stage) {
                                CompanionStage.StartingPairing -> "Opening secure pairing"
                                CompanionStage.Pairing -> "Confirming code"
                                else -> "Connecting to your TV"
                            },
                            fontWeight = FontWeight.SemiBold
                        )
                        Text(state.currentHost, color = SoftText, fontSize = 12.sp)
                    }
                }
            }
        }

        if (state.stage == CompanionStage.AwaitingCode) {
            PanelCard {
                Text("Approve this phone", fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(6.dp))
                Text(
                    "Look at your TV screen. A six-character code should appear there. Enter that code below once; the app remembers this TV for next time.",
                    color = SoftText,
                    fontSize = 13.sp,
                    lineHeight = 19.sp
                )
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = state.code,
                    onValueChange = onCodeChange,
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Code shown on the TV") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(
                        capitalization = KeyboardCapitalization.Characters,
                        keyboardType = KeyboardType.Ascii
                    )
                )
                Spacer(Modifier.height(10.dp))
                Button(
                    onClick = onSubmitCode,
                    enabled = state.code.length == 6,
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(containerColor = Mint, contentColor = Color(0xFF08201F))
                ) {
                    Text("Pair and open remote")
                }
            }
        }

        if (state.devices.isEmpty() && !state.scanning &&
            state.stage != CompanionStage.AwaitingCode &&
            state.stage != CompanionStage.StartingPairing &&
            state.stage != CompanionStage.Pairing &&
            state.stage != CompanionStage.Connecting) {
            PanelCard {
                Text("TV not found?", fontWeight = FontWeight.SemiBold)
                Text(
                    "Some set-top boxes do not advertise this service. You can try the local IP shown in the box's network settings; no ADB, bridge, or token is needed for this pairing method.",
                    color = SoftText,
                    fontSize = 12.sp,
                    lineHeight = 18.sp
                )
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(
                    value = state.manualHost,
                    onValueChange = onManualHostChange,
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("TV local IP address (optional)") },
                    placeholder = { Text("192.168.1.50") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number)
                )
                Spacer(Modifier.height(8.dp))
                Button(
                    onClick = onPairManual,
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(containerColor = KeyBackground)
                ) {
                    Text("Try this address")
                }
            }
        }

        state.error?.let { ErrorCard(it) }
    }
}

@Composable
private fun RemotePanel(
    state: RemoteUiState,
    onKey: (Int) -> Unit,
    onLaunch: (String) -> Unit,
    onReconnect: () -> Unit,
    onFindAnother: () -> Unit
) {
    val remoteConnected = state.connected || state.bluetooth.connected
    val remoteDeviceName = if (state.bluetooth.connected) state.bluetooth.peerName.ifBlank { "Bluetooth TV" } else state.deviceName
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        PanelCard {
            Row(verticalAlignment = Alignment.CenterVertically) {
                androidx.compose.foundation.layout.Box(
                    modifier = Modifier
                        .size(9.dp)
                        .clip(CircleShape)
                        .background(if (remoteConnected) Mint else Color(0xFFFFBD59))
                )
                Spacer(Modifier.width(9.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(remoteDeviceName, fontWeight = FontWeight.SemiBold)
                    Text(
                        when {
                            state.bluetooth.connected -> "Bluetooth connected"
                            state.connected -> "Wi-Fi remote · " + state.pairedHost
                            else -> "Saved · " + state.pairedHost
                        },
                        fontSize = 12.sp,
                        color = SoftText
                    )
                }
                if (!remoteConnected && state.pairedHost.isNotBlank()) {
                    Button(onClick = onReconnect, colors = ButtonDefaults.buttonColors(containerColor = Mint, contentColor = Color(0xFF08201F))) {
                        Text("Reconnect")
                    }
                }
            }
        }

        PanelCard {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                RemoteButton("⏻", "Power", onClick = { onKey(TvKeys.POWER) }, enabled = remoteConnected, modifier = Modifier.weight(1f), accent = Color(0xFFFFA3A8))
                RemoteButton("◖", "Mute", onClick = { onKey(TvKeys.MUTE) }, enabled = state.connected, modifier = Modifier.weight(1f))
                RemoteButton("⋯", "Menu", onClick = { onKey(TvKeys.MENU) }, enabled = state.connected, modifier = Modifier.weight(1f))
            }
            Spacer(Modifier.height(18.dp))
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(9.dp)) {
                RemoteButton("↑", "Up", { onKey(TvKeys.UP) }, remoteConnected, Modifier.size(72.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(9.dp), verticalAlignment = Alignment.CenterVertically) {
                    RemoteButton("←", "Left", { onKey(TvKeys.LEFT) }, state.connected, Modifier.size(72.dp))
                    RemoteButton("OK", "Select", { onKey(TvKeys.OK) }, remoteConnected, Modifier.size(78.dp), accent = Mint)
                    RemoteButton("→", "Right", { onKey(TvKeys.RIGHT) }, state.connected, Modifier.size(72.dp))
                }
                RemoteButton("↓", "Down", { onKey(TvKeys.DOWN) }, state.connected, Modifier.size(72.dp))
            }
            Spacer(Modifier.height(16.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                RemoteButton("↶", "Back", { onKey(TvKeys.BACK) }, remoteConnected, Modifier.weight(1f))
                RemoteButton("⌂", "Home", { onKey(TvKeys.HOME) }, state.connected, Modifier.weight(1f), accent = Mint)
                RemoteButton("▶", "Play / pause", { onKey(TvKeys.PLAY_PAUSE) }, state.connected, Modifier.weight(1f))
            }
        }

        PanelCard {
            Text("Open an app", fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                Button(
                    onClick = { onLaunch(NETFLIX_URL) },
                    enabled = state.connected,
                    modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFE50914), contentColor = Color.White)
                ) { Text("NETFLIX", fontWeight = FontWeight.Bold) }
                Button(
                    onClick = { onLaunch(YOUTUBE_URL) },
                    enabled = state.connected,
                    modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFFF0033), contentColor = Color.White)
                ) { Text("YouTube", fontWeight = FontWeight.Bold) }
            }
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                RemoteButton("＋", "Volume up", { onKey(TvKeys.VOLUME_UP) }, state.connected, Modifier.weight(1f))
                RemoteButton("−", "Volume down", { onKey(TvKeys.VOLUME_DOWN) }, state.connected, Modifier.weight(1f))
                RemoteButton("CH +", "Channel up", { onKey(TvKeys.CHANNEL_UP) }, state.connected, Modifier.weight(1f))
                RemoteButton("CH −", "Channel down", { onKey(TvKeys.CHANNEL_DOWN) }, state.connected, Modifier.weight(1f))
            }
        }

        state.error?.let { ErrorCard(it) }

        if (!state.bluetooth.connected) {
            Button(
                onClick = onFindAnother,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1A2B44))
            ) {
                Text("Find another TV / pair again")
            }
        }
    }
}

@Composable
private fun PanelCard(content: @Composable () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(22.dp))
            .background(Panel)
            .padding(17.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        content()
    }
}

@Composable
private fun RemoteButton(
    symbol: String,
    label: String,
    onClick: () -> Unit,
    enabled: Boolean,
    modifier: Modifier = Modifier,
    accent: Color = KeyBackground
) {
    Button(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.height(66.dp),
        shape = RoundedCornerShape(17.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = accent,
            contentColor = if (accent == Mint) Color(0xFF08201F) else Color(0xFFEEF4FF),
            disabledContainerColor = Color(0xFF182337),
            disabledContentColor = Color(0xFF61718A)
        ),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 6.dp, vertical = 5.dp)
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Text(symbol, fontSize = if (symbol.length > 2) 15.sp else 23.sp, fontWeight = FontWeight.SemiBold, lineHeight = 25.sp)
            Text(label, fontSize = 9.sp, lineHeight = 11.sp, textAlign = TextAlign.Center)
        }
    }
}

@Composable
private fun ErrorCard(message: String) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(15.dp))
            .background(Color(0xFF321F2A))
            .padding(13.dp)
    ) {
        Text("Connection note", color = Color(0xFFFFB9C0), fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
        Text(message, color = Color(0xFFF5DDE1), fontSize = 12.sp, lineHeight = 17.sp)
    }
}
