package expo.modules.habittile

import android.Manifest
import android.app.NotificationManager
import android.app.StatusBarManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import expo.modules.interfaces.permissions.Permissions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * JS bridge over [HabitStore] so the React app and the Tile read/write the same
 * store. Also exposes the platform escape hatches the app's onboarding needs:
 * the AOSP battery-optimization exemption and a route to app settings for the
 * OEM autostart layer, plus the streak-reminder settings and its notification
 * permission.
 */
class ExpoHabitTileModule : Module() {

    private val context: Context
        get() = requireNotNull(appContext.reactContext) {
            "React context is not available"
        }.applicationContext

    override fun definition() = ModuleDefinition {
        Name("ExpoHabitTile")

        OnCreate {
            ReminderScheduler.ensureChannel(context)
        }

        // Native reconcile on every foreground — no JS round-trip needed, and it
        // catches alarms lost to reboots/force-stops the receivers didn't see.
        OnActivityEntersForeground {
            ReminderScheduler.scheduleNext(context)
        }

        Function("getState") { stateMap() }

        Function("logHabit") {
            HabitStore.logHabit(context)
            ReminderScheduler.cancelNotification(context)
            ReminderScheduler.scheduleNext(context)
            ReminderScheduler.refreshTile(context)
            stateMap()
        }

        Function("setRestDay") { rest: Boolean ->
            HabitStore.setRestDay(context, rest)
            if (rest) ReminderScheduler.cancelNotification(context)
            ReminderScheduler.scheduleNext(context)
            ReminderScheduler.refreshTile(context)
            stateMap()
        }

        Function("heartbeat") { HabitStore.writeHeartbeat(context) }

        Function("getHeartbeatGapMs") { HabitStore.heartbeatGapMs(context).toDouble() }

        // ---- Streak-at-risk reminder ----
        Function("getReminder") { reminderMap() }

        Function("setReminder") { enabled: Boolean, hour: Int, minute: Int ->
            HabitStore.setReminder(context, enabled, hour, minute)
            ReminderScheduler.scheduleNext(context)
            reminderMap()
        }

        Function("reconcileReminder") {
            ReminderScheduler.scheduleNext(context)
            reminderMap()
        }

        // Android 13+ needs the POST_NOTIFICATIONS runtime permission. Below
        // that there is nothing to ask; report the app-level toggle instead.
        AsyncFunction("requestNotificationPermission") { promise: Promise ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                Permissions.askForPermissionsWithPermissionsManager(
                    appContext.permissions,
                    promise,
                    Manifest.permission.POST_NOTIFICATIONS
                )
            } else {
                promise.resolve(legacyPermissionBundle())
            }
        }

        AsyncFunction("getNotificationPermission") { promise: Promise ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                Permissions.getPermissionsWithPermissionsManager(
                    appContext.permissions,
                    promise,
                    Manifest.permission.POST_NOTIFICATIONS
                )
            } else {
                promise.resolve(legacyPermissionBundle())
            }
        }

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

    private fun reminderMap(): Map<String, Any> {
        val enabled = HabitStore.reminderEnabled(context)
        val next = if (enabled) ReminderScheduler.nextTriggerAt(context) else 0L
        return mapOf(
            "enabled" to enabled,
            "hour" to HabitStore.reminderHour(context),
            "minute" to HabitStore.reminderMinute(context),
            "nextTriggerAt" to next.toDouble(),
            "notificationsAllowed" to ReminderScheduler.notificationsAllowed(context)
        )
    }

    /** Pre-33 shape, matching what the permissions manager resolves with. */
    private fun legacyPermissionBundle(): Bundle {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val granted = nm.areNotificationsEnabled()
        return Bundle().apply {
            putString("status", if (granted) "granted" else "denied")
            putBoolean("granted", granted)
            putBoolean("canAskAgain", true)
            putString("expires", "never")
        }
    }

    private fun startExternal(intent: Intent) {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
    }
}
