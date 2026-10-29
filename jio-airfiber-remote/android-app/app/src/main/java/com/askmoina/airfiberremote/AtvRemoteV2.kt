package com.askmoina.airfiberremote

import android.content.Context
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.bouncycastle.asn1.x500.X500Name
import org.bouncycastle.asn1.x509.BasicConstraints
import org.bouncycastle.asn1.x509.Extension
import org.bouncycastle.cert.jcajce.JcaX509CertificateConverter
import org.bouncycastle.cert.jcajce.JcaX509v3CertificateBuilder
import org.bouncycastle.jce.provider.BouncyCastleProvider
import org.bouncycastle.operator.jcajce.JcaContentSignerBuilder
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.EOFException
import java.io.InputStream
import java.io.OutputStream
import java.math.BigInteger
import java.net.InetSocketAddress
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.Security
import java.security.cert.X509Certificate
import java.security.interfaces.RSAPublicKey
import java.util.Date
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket
import javax.net.ssl.X509TrustManager

/**
 * Small, local-only client for Android TV Remote v2. The phone's identity is
 * kept in app-private storage. Pairing uses the code shown by the TV; after
 * pairing, the TV certificate is pinned before reconnecting to the control port.
 */
class AtvRemoteV2(context: Context) : Closeable {
    private val appContext = context.applicationContext
    private val preferences = appContext.getSharedPreferences("airfiber_remote", Context.MODE_PRIVATE)
    private val identityStore = ClientIdentityStore(appContext)
    private val background = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val writeMutex = Mutex()

    val connected = MutableStateFlow(false)
    val lastError = MutableStateFlow<String?>(null)
    val powered = MutableStateFlow(false)

    private var pendingPairing: TlsConnection? = null
    private var remoteSocket: SSLSocket? = null
    private var remoteReader: kotlinx.coroutines.Job? = null
    private val identity by lazy { identityStore.getOrCreate() }

    suspend fun beginPairing(host: String): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            closePairing()
            require(host.isNotBlank()) { "Choose a TV first." }
            val connection = openTls(host.trim(), PAIRING_PORT)
            pendingPairing = connection
            val input = connection.socket.inputStream
            val output = connection.socket.outputStream

            output.writeFramed(outerMessage {
                message(FIELD_PAIRING_REQUEST) {
                    string(1, "atvremote")
                    string(2, "AskMoina AirFiber Remote")
                }
            })

            while (true) {
                val reply = parseProto(input.readFramed())
                checkTvStatus(reply)

                when {
                    reply.containsKey(FIELD_PAIRING_REQUEST_ACK) -> {
                        output.writeFramed(outerMessage {
                            message(FIELD_OPTIONS) {
                                message(1) {
                                    varint(1, HEXADECIMAL_ENCODING)
                                    varint(2, CODE_LENGTH)
                                }
                                varint(3, INPUT_ROLE)
                            }
                        })
                    }

                    reply.containsKey(FIELD_OPTIONS) || reply.containsKey(FIELD_OPTIONS_ACK) -> {
                        output.writeFramed(outerMessage {
                            message(FIELD_CONFIGURATION) {
                                message(1) {
                                    varint(1, HEXADECIMAL_ENCODING)
                                    varint(2, CODE_LENGTH)
                                }
                                varint(2, INPUT_ROLE)
                            }
                        })
                    }

                    reply.containsKey(FIELD_CONFIGURATION_ACK) -> return@runCatching

                    else -> error("The TV replied with an unsupported pairing message.")
                }
            }
        }.onFailure {
            closePairing()
            lastError.value = friendlyConnectionError(it)
        }
    }

    suspend fun finishPairing(code: String): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            val connection = pendingPairing ?: error("Start pairing with the TV again.")
            val digest = pairingDigest(connection, code)
            connection.socket.outputStream.writeFramed(outerMessage {
                message(FIELD_SECRET) { bytes(1, digest) }
            })

            val reply = parseProto(connection.socket.inputStream.readFramed())
            checkTvStatus(reply)
            if (!reply.containsKey(FIELD_SECRET_ACK)) {
                error("The TV did not accept that code. Check the screen and try again.")
            }

            val serverCert = connection.serverCertificate
                ?: error("The TV's pairing certificate was not available.")
            preferences.edit()
                .putString(KEY_SERVER_FINGERPRINT, fingerprint(serverCert))
                .apply()
        }.onFailure {
            lastError.value = it.message ?: "Pairing did not complete."
        }.also {
            closePairing()
        }
    }

    suspend fun connect(host: String): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            disconnectRemote()
            lastError.value = null
            val connection = openTls(host.trim(), REMOTE_PORT)
            val expectedFingerprint = preferences.getString(KEY_SERVER_FINGERPRINT, null)
            val actualFingerprint = connection.serverCertificate?.let(::fingerprint)
                ?: error("The TV did not provide a certificate.")
            if (expectedFingerprint.isNullOrBlank()) {
                connection.socket.close()
                error("This TV is not paired yet. Tap Pair with TV first.")
            }
            if (!MessageDigest.isEqual(
                    expectedFingerprint.toByteArray(Charsets.UTF_8),
                    actualFingerprint.toByteArray(Charsets.UTF_8)
                )
            ) {
                connection.socket.close()
                error("The TV identity changed. Forget this TV and pair again only if this is your device.")
            }

            val socket = connection.socket
            remoteSocket = socket
            val input = socket.inputStream
            socket.soTimeout = HANDSHAKE_TIMEOUT_MS
            var ready = false
            while (!ready) {
                val message = parseProto(input.readFramed())
                ready = handleRemoteMessage(message, socket)
            }
            socket.soTimeout = 0
            connected.value = true
            lastError.value = null
            remoteReader = background.launch {
                try {
                    while (true) {
                        handleRemoteMessage(parseProto(socket.inputStream.readFramed()), socket)
                    }
                } catch (error: Throwable) {
                    if (remoteSocket === socket) {
                        connected.value = false
                        powered.value = false
                        lastError.value = error.message ?: "The TV connection was interrupted."
                        Log.w(TAG, "Remote connection ended", error)
                    }
                }
            }
        }.onFailure {
            connected.value = false
            lastError.value = friendlyConnectionError(it)
        }
    }

    fun sendKey(keyCode: Int) {
        sendRemote {
            message(FIELD_KEY_INJECT) {
                varint(1, keyCode)
                varint(2, SHORT_PRESS)
            }
        }
    }

    fun launchApp(link: String) {
        sendRemote { message(FIELD_APP_LINK) { string(1, link) } }
    }

    fun disconnectRemote() {
        remoteReader?.cancel()
        remoteReader = null
        val socket = remoteSocket
        remoteSocket = null
        runCatching { socket?.close() }
        connected.value = false
        powered.value = false
    }

    fun clearSavedTv() {
        disconnectRemote()
        closePairing()
        preferences.edit().remove(KEY_SERVER_FINGERPRINT).apply()
    }

    override fun close() {
        closePairing()
        disconnectRemote()
        background.cancel()
    }

    private fun sendRemote(build: ProtoWriter.() -> Unit) {
        val socket = remoteSocket ?: return
        val payload = ProtoWriter().apply(build).toByteArray()
        background.launch {
            runCatching {
                writeMutex.withLock {
                    socket.outputStream.writeFramed(payload)
                }
            }.onFailure {
                if (remoteSocket === socket) {
                    connected.value = false
                    lastError.value = it.message ?: "Could not send the remote command."
                }
            }
        }
    }

    private suspend fun handleRemoteMessage(
        message: Map<Int, List<WireValue>>,
        socket: SSLSocket
    ): Boolean {
        when {
            message.containsKey(FIELD_REMOTE_CONFIGURE) -> {
                val payload = ProtoWriter().apply {
                    message(FIELD_REMOTE_CONFIGURE) {
                        varint(1, FEATURES)
                        message(2) {
                            varint(3, 1)
                            string(4, "1")
                            string(5, "askmoina-airfiber")
                            string(6, "0.1.0")
                        }
                    }
                }.toByteArray()
                writeMutex.withLock { socket.outputStream.writeFramed(payload) }
            }

            message.containsKey(FIELD_SET_ACTIVE) -> {
                val payload = ProtoWriter().apply {
                    message(FIELD_SET_ACTIVE) { varint(1, FEATURES) }
                }.toByteArray()
                writeMutex.withLock { socket.outputStream.writeFramed(payload) }
            }

            message.containsKey(FIELD_PING_REQUEST) -> {
                val value = message.message(FIELD_PING_REQUEST)?.num(1) ?: 0L
                val payload = ProtoWriter().apply {
                    message(FIELD_PING_RESPONSE) { varint(1, value) }
                }.toByteArray()
                writeMutex.withLock { socket.outputStream.writeFramed(payload) }
            }

            message.containsKey(FIELD_START) -> {
                powered.value = message.message(FIELD_START)?.num(1) == 1L
                return true
            }
        }
        return false
    }

    private fun openTls(host: String, port: Int): TlsConnection {
        val client = identity
        val keyManagers = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm())
            .apply { init(client.keyStore, ClientIdentityStore.PASSWORD) }
            .keyManagers
        val capture = CapturingTrustManager()
        val sslContext = SSLContext.getInstance("TLS").apply {
            init(keyManagers, arrayOf(capture), SecureRandom())
        }
        val socket = sslContext.socketFactory.createSocket() as SSLSocket
        socket.connect(InetSocketAddress(host, port), CONNECT_TIMEOUT_MS)
        socket.soTimeout = HANDSHAKE_TIMEOUT_MS
        socket.startHandshake()
        return TlsConnection(socket, capture)
    }

    private fun pairingDigest(connection: TlsConnection, enteredCode: String): ByteArray {
        val code = enteredCode.trim().uppercase()
        require(code.length == CODE_LENGTH) { "Enter all six characters shown on the TV." }
        require(code.all { it in '0'..'9' || it in 'A'..'F' }) {
            "The TV code uses only digits 0-9 and letters A-F."
        }

        val serverKey = connection.serverCertificate?.publicKey as? RSAPublicKey
            ?: error("The TV did not provide an RSA pairing certificate.")
        val clientKey = identity.certificate.publicKey as? RSAPublicKey
            ?: error("The phone's pairing certificate is invalid.")
        val digest = MessageDigest.getInstance("SHA-256").apply {
            update(clientKey.modulus.toUnsignedBytes())
            update(clientKey.publicExponent.toUnsignedBytes())
            update(serverKey.modulus.toUnsignedBytes())
            update(serverKey.publicExponent.toUnsignedBytes())
            update(code.substring(2).hexToBytes())
        }.digest()

        val expected = code.substring(0, 2).toInt(16)
        require((digest[0].toInt() and 0xFF) == expected) {
            "That code does not match. Check the six characters displayed on the TV."
        }
        return digest
    }

    private fun checkTvStatus(message: Map<Int, List<WireValue>>) {
        val status = message.num(FIELD_STATUS) ?: STATUS_OK.toLong()
        if (status != STATUS_OK.toLong()) {
            error(
                when (status.toInt()) {
                    STATUS_BAD_CONFIGURATION -> "The TV rejected the pairing setup."
                    STATUS_BAD_SECRET -> "The TV rejected the pairing code."
                    else -> "The TV returned pairing status " + status + "."
                }
            )
        }
    }

    private fun closePairing() {
        runCatching { pendingPairing?.socket?.close() }
        pendingPairing = null
    }

    private fun friendlyConnectionError(error: Throwable): String {
        val message = error.message.orEmpty()
        return when {
            message.contains("failed to connect", ignoreCase = true) ||
                message.contains("connection refused", ignoreCase = true) ||
                message.contains("timeout", ignoreCase = true) ->
                "No Android TV remote service answered. The Jio box may not expose this pairing method."
            message.isNotBlank() -> message
            else -> "Could not connect to the TV."
        }
    }

    private fun fingerprint(certificate: X509Certificate): String =
        MessageDigest.getInstance("SHA-256").digest(certificate.encoded)
            .joinToString("") { byte -> "%02x".format(byte.toInt() and 0xFF) }

    private data class TlsConnection(
        val socket: SSLSocket,
        private val trustManager: CapturingTrustManager
    ) {
        val serverCertificate: X509Certificate?
            get() = trustManager.peerCertificate
                ?: runCatching { socket.session.peerCertificates.firstOrNull() as? X509Certificate }.getOrNull()
    }

    private class CapturingTrustManager : X509TrustManager {
        @Volatile var peerCertificate: X509Certificate? = null
        override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) = Unit
        override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
            peerCertificate = chain.firstOrNull()
        }
        override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
    }

    private class ClientIdentityStore(context: Context) {
        private val file = java.io.File(context.filesDir, "airfiber-client.p12")

        fun getOrCreate(): ClientIdentity {
            if (file.exists()) {
                runCatching { loadExisting() }.getOrNull()?.let { return it }
                runCatching { file.delete() }
            }
            if (Security.getProvider(BouncyCastleProvider.PROVIDER_NAME) == null) {
                Security.addProvider(BouncyCastleProvider())
            }
            val generator = KeyPairGenerator.getInstance("RSA")
            generator.initialize(2048, SecureRandom())
            val keyPair = generator.generateKeyPair()
            val subject = X500Name("CN=askmoina-airfiber")
            val now = System.currentTimeMillis()
            val certificateBuilder = JcaX509v3CertificateBuilder(
                subject,
                BigInteger.valueOf(now),
                Date(now - 60_000L),
                Date(now + 10L * 365 * 24 * 60 * 60 * 1000),
                subject,
                keyPair.public
            ).addExtension(Extension.basicConstraints, false, BasicConstraints(false))
            val signer = JcaContentSignerBuilder("SHA256withRSA")
                .setProvider(BouncyCastleProvider.PROVIDER_NAME)
                .build(keyPair.private)
            val certificate = JcaX509CertificateConverter()
                .setProvider(BouncyCastleProvider.PROVIDER_NAME)
                .getCertificate(certificateBuilder.build(signer))
            val store = KeyStore.getInstance("PKCS12")
            store.load(null, null)
            store.setKeyEntry(ALIAS, keyPair.private, PASSWORD, arrayOf(certificate))
            file.outputStream().use { store.store(it, PASSWORD) }
            return ClientIdentity(store, keyPair.private, certificate)
        }

        private fun loadExisting(): ClientIdentity {
            val store = KeyStore.getInstance("PKCS12")
            file.inputStream().use { store.load(it, PASSWORD) }
            val key = store.getKey(ALIAS, PASSWORD) as java.security.PrivateKey
            val certificate = store.getCertificate(ALIAS) as X509Certificate
            return ClientIdentity(store, key, certificate)
        }

        companion object {
            const val ALIAS = "airfiber-remote"
            val PASSWORD = "askmoina-airfiber".toCharArray()
        }
    }

    private data class ClientIdentity(
        val keyStore: KeyStore,
        val privateKey: java.security.PrivateKey,
        val certificate: X509Certificate
    )

    private class ProtoWriter {
        private val output = ByteArrayOutputStream()

        fun varint(field: Int, value: Int) = varint(field, value.toLong())

        fun varint(field: Int, value: Long) = apply {
            writeVarint(output, ((field shl 3) or 0).toLong())
            writeVarint(output, value)
        }

        fun bytes(field: Int, value: ByteArray) = apply {
            writeVarint(output, ((field shl 3) or 2).toLong())
            writeVarint(output, value.size.toLong())
            output.write(value)
        }

        fun string(field: Int, value: String) = bytes(field, value.toByteArray(Charsets.UTF_8))

        fun message(field: Int, block: ProtoWriter.() -> Unit) = bytes(
            field,
            ProtoWriter().apply(block).toByteArray()
        )

        private fun writeVarint(out: ByteArrayOutputStream, original: Long) {
            var value = original
            while (true) {
                val group = (value and 0x7F).toInt()
                value = value ushr 7
                if (value == 0L) {
                    out.write(group)
                    return
                }
                out.write(group or 0x80)
            }
        }

        fun toByteArray(): ByteArray = output.toByteArray()
    }

    private sealed interface WireValue {
        data class NumberValue(val value: Long) : WireValue
        data class BytesValue(val value: ByteArray) : WireValue
    }

    private fun parseProto(bytes: ByteArray): Map<Int, List<WireValue>> {
        val fields = mutableMapOf<Int, MutableList<WireValue>>()
        var position = 0

        fun readVarint(): Long {
            var result = 0L
            var shift = 0
            while (true) {
                if (position >= bytes.size) throw EOFException("Incomplete TV message")
                val next = bytes[position++].toInt() and 0xFF
                result = result or ((next and 0x7F).toLong() shl shift)
                if ((next and 0x80) == 0) return result
                shift += 7
                if (shift > 63) error("Invalid TV message varint")
            }
        }

        while (position < bytes.size) {
            val tag = readVarint()
            val field = (tag ushr 3).toInt()
            when ((tag and 0x7).toInt()) {
                0 -> fields.getOrPut(field) { mutableListOf() }
                    .add(WireValue.NumberValue(readVarint()))
                1 -> {
                    if (position + 8 > bytes.size) throw EOFException("Incomplete TV message")
                    position += 8
                }
                2 -> {
                    val size = readVarint().toInt()
                    if (size < 0 || position + size > bytes.size) throw EOFException("Invalid TV message length")
                    fields.getOrPut(field) { mutableListOf() }
                        .add(WireValue.BytesValue(bytes.copyOfRange(position, position + size)))
                    position += size
                }
                5 -> {
                    if (position + 4 > bytes.size) throw EOFException("Incomplete TV message")
                    position += 4
                }
                else -> error("Unsupported TV message field.")
            }
        }
        return fields
    }

    private fun Map<Int, List<WireValue>>.num(field: Int): Long? =
        (this[field]?.firstOrNull() as? WireValue.NumberValue)?.value

    private fun Map<Int, List<WireValue>>.bytes(field: Int): ByteArray? =
        (this[field]?.firstOrNull() as? WireValue.BytesValue)?.value

    private fun Map<Int, List<WireValue>>.message(field: Int): Map<Int, List<WireValue>>? =
        bytes(field)?.let(::parseProto)

    private fun InputStream.readFramed(): ByteArray {
        var length = 0L
        var shift = 0
        while (true) {
            val next = read()
            if (next < 0) throw EOFException("The TV closed the connection.")
            length = length or ((next and 0x7F).toLong() shl shift)
            if ((next and 0x80) == 0) break
            shift += 7
            if (shift > 28) error("Invalid TV message length.")
        }
        if (length < 0 || length > 1_048_576) error("TV message is too large.")
        val data = ByteArray(length.toInt())
        var offset = 0
        while (offset < data.size) {
            val count = read(data, offset, data.size - offset)
            if (count < 0) throw EOFException("The TV closed the connection mid-message.")
            offset += count
        }
        return data
    }

    private fun OutputStream.writeFramed(payload: ByteArray) {
        writeVarint(this, payload.size.toLong())
        write(payload)
        flush()
    }

    private fun outerMessage(block: ProtoWriter.() -> Unit): ByteArray =
        ProtoWriter().apply {
            varint(1, PROTOCOL_VERSION)
            varint(2, STATUS_OK)
            block()
        }.toByteArray()

    private fun writeVarint(output: OutputStream, original: Long) {
        var value = original
        while (true) {
            val group = (value and 0x7F).toInt()
            value = value ushr 7
            if (value == 0L) {
                output.write(group)
                return
            }
            output.write(group or 0x80)
        }
    }

    private fun BigInteger.toUnsignedBytes(): ByteArray {
        val encoded = toByteArray()
        return if (encoded.size > 1 && encoded[0] == 0.toByte()) {
            encoded.copyOfRange(1, encoded.size)
        } else encoded
    }

    private fun String.hexToBytes(): ByteArray =
        ByteArray(length / 2) { index ->
            substring(index * 2, index * 2 + 2).toInt(16).toByte()
        }

    private companion object {
        const val TAG = "AirFiberRemote"
        const val PAIRING_PORT = 6467
        const val REMOTE_PORT = 6466
        const val CONNECT_TIMEOUT_MS = 5_000
        const val HANDSHAKE_TIMEOUT_MS = 8_000
        const val PROTOCOL_VERSION = 2
        const val STATUS_OK = 200
        const val STATUS_BAD_CONFIGURATION = 401
        const val STATUS_BAD_SECRET = 402
        const val FIELD_STATUS = 2
        const val FIELD_PAIRING_REQUEST = 10
        const val FIELD_PAIRING_REQUEST_ACK = 11
        const val FIELD_OPTIONS = 20
        const val FIELD_OPTIONS_ACK = 21
        const val FIELD_CONFIGURATION = 30
        const val FIELD_CONFIGURATION_ACK = 31
        const val FIELD_SECRET = 40
        const val FIELD_SECRET_ACK = 41
        const val FIELD_REMOTE_CONFIGURE = 1
        const val FIELD_SET_ACTIVE = 2
        const val FIELD_PING_REQUEST = 8
        const val FIELD_PING_RESPONSE = 9
        const val FIELD_KEY_INJECT = 10
        const val FIELD_START = 40
        const val FIELD_APP_LINK = 90
        const val FEATURES = 1 or 2 or 32 or 64 or 512
        const val SHORT_PRESS = 3
        const val HEXADECIMAL_ENCODING = 3
        const val INPUT_ROLE = 1
        const val CODE_LENGTH = 6
        const val KEY_SERVER_FINGERPRINT = "server_fingerprint"
    }
}
