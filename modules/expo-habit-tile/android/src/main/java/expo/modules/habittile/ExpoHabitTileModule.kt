package expo.modules.habittile

import android.app.StatusBarManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.service.quicksettings.TileService
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * JS bridge over [HabitStore] so the React app and the Tile read/write the same
 * store. Also exposes the platform escape hatches the app's onboarding needs:
 * the AOSP battery-optimization exemption and a route to app settings for the
 * OEM autostart layer.
 */
class ExpoHabitTileModule : Module() {

    private val context: Context
        get() = requireNotNull(appContext.reactContext) {
            "React context is not available"
        }.applicationContext

    override fun definition() = ModuleDefinition {
        Name("ExpoHabitTile")

        Function("getState") { stateMap() }

        Function("logHabit") {
            HabitStore.logHabit(context)
            requestTileUpdate()
            stateMap()
        }

        Function("setRestDay") { rest: Boolean ->
            HabitStore.setRestDay(context, rest)
            requestTileUpdate()
            stateMap()
        }

        Function("heartbeat") { HabitStore.writeHeartbeat(context) }

        Function("getHeartbeatGapMs") { HabitStore.heartbeatGapMs(context).toDouble() }

        // ---- Platform / battery escape hatches ----
        Function("isIgnoringBatteryOptimizations") {
            val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
            pm.isIgnoringBatteryOptimizations(context.packageName)
        }

        // The plain settings LIST (always permitted), not the direct-request
        // dialog (which needs a Play-restricted permission).
        Function("openBatteryOptimizationSettings") {
            startExternal(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        }

        Function("openAppSettings") {
            startExternal(
                Intent(
                    Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:${context.packageName}")
                )
            )
        }

        Function("getManufacturer") { Build.MANUFACTURER ?: "" }

        // System prompt asking the user to add our tile (API 33+). The proper,
        // supported way to add a custom tile programmatically.
        Function("requestAddTile") {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                val sbm = context.getSystemService(StatusBarManager::class.java)
                sbm.requestAddTileService(
                    ComponentName(context, HabitTileService::class.java),
                    "Log habit",
                    Icon.createWithResource(context, R.drawable.ic_habit_tile),
                    { it.run() },
                    { }
                )
            }
        }
    }

    private fun stateMap(): Map<String, Any> {
        val now = System.currentTimeMillis()
        return mapOf(
            "streak" to HabitStore.currentStreak(context, now),
            "loggedToday" to HabitStore.loggedToday(context, now),
            "restDay" to HabitStore.isRestDay(context, now),
            "lastLoggedAt" to HabitStore.lastLoggedAt(context).toDouble(),
            "subtitle" to HabitStore.subtitle(context, now),
            "hoursLeftToday" to HabitStore.hoursLeftToday(now)
        )
    }

    /** Ask the system to re-run onStartListening so the tile reflects a JS log. */
    private fun requestTileUpdate() {
        try {
            TileService.requestListeningState(
                context,
                ComponentName(context, HabitTileService::class.java)
            )
        } catch (_: Throwable) {
            // no-op: the tile may not be added, which is fine
        }
    }

    private fun startExternal(intent: Intent) {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
    }
}
