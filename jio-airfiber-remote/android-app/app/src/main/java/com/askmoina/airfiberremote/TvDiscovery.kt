package com.askmoina.airfiberremote

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.net.InetAddress

data class TvDevice(
    val host: String,
    val name: String
)

/**
 * Looks for the standard Android TV Remote v2 service on the current Wi-Fi.
 * The discovery only finds devices that advertise that service; it cannot
 * guarantee that every operator set-top box exposes a compatible remote API.
 */
class TvDiscovery(private val context: Context) {
    suspend fun scan(timeoutMs: Long = 6500L): List<TvDevice> = withContext(Dispatchers.Main) {
        val manager = context.getSystemService(Context.NSD_SERVICE) as NsdManager
        val found = linkedMapOf<String, TvDevice>()
        val resolvedNames = mutableSetOf<String>()
        val finished = CompletableDeferred<Unit>()
        val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
        val multicastLock = runCatching {
            wifi?.createMulticastLock("airfiber-remote-discovery")?.apply {
                setReferenceCounted(false)
                acquire()
            }
        }.getOrNull()
        var started = false

        val resolveListenerFactory: (String) -> NsdManager.ResolveListener = { serviceName ->
            object : NsdManager.ResolveListener {
                override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) = Unit

                override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
                    val address: InetAddress? = serviceInfo.host
                    val host = address?.hostAddress ?: return
                    if (host.contains(":")) return
                    val name = serviceInfo.serviceName.ifBlank { serviceName }.ifBlank { "Android TV" }
                    found[host] = TvDevice(host, name)
                }
            }
        }

        val listener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(serviceType: String) {
                started = true
            }

            override fun onServiceFound(serviceInfo: NsdServiceInfo) {
                if (!serviceInfo.serviceType.contains("_androidtvremote2._tcp", ignoreCase = true)) return
                val key = serviceInfo.serviceName + "@" + serviceInfo.serviceType
                if (!resolvedNames.add(key)) return
                runCatching {
                    manager.resolveService(serviceInfo, resolveListenerFactory(serviceInfo.serviceName))
                }
            }

            override fun onServiceLost(serviceInfo: NsdServiceInfo) {
                // Keep a result already resolved during this short discovery window.
            }

            override fun onDiscoveryStopped(serviceType: String) {
                finished.complete(Unit)
            }

            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                finished.complete(Unit)
                runCatching { manager.stopServiceDiscovery(this) }
            }

            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {
                runCatching { manager.stopServiceDiscovery(this) }
            }
        }

        try {
            manager.discoverServices(
                "_androidtvremote2._tcp.",
                NsdManager.PROTOCOL_DNS_SD,
                listener
            )
            withTimeoutOrNull(timeoutMs) { finished.await() }
            // Allow a final resolve callback to deliver the last discovered host.
            delay(500L)
            found.values.sortedBy { it.name.lowercase() }
        } catch (_: Throwable) {
            found.values.sortedBy { it.name.lowercase() }
        } finally {
            if (started) runCatching { manager.stopServiceDiscovery(listener) }
            runCatching {
                if (multicastLock?.isHeld == true) multicastLock.release()
            }
        }
    }
}
