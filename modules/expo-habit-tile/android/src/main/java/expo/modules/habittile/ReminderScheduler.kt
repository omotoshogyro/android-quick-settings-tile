package expo.modules.habittile

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.os.Build
import android.service.quicksettings.TileService
import java.util.Calendar

/**
 * The "streak at risk" reminder. Pure native so it works while the JS process
 * is dead (the common case: the user logs from the tile all day and never
 * opens the app).
 *
 * The alarm is a WAKE-UP, not a decision. Nothing is pre-computed: when it
 * fires, [onAlarmFired] reads [HabitStore] and only notifies if there is a
 * live streak that is still unlogged today and it isn't a rest day. That keeps
 * the project's one rule — derive on read, never maintain state on a timer —
 * and means a tile log at 3pm silently makes the 8pm alarm a no-op.
 *
 * [scheduleNext] is idempotent (same PendingIntent replaces the old alarm) and
 * is called from every touchpoint: tile click/shade open, JS mutations, app
 * foreground, boot / time / timezone change, and the alarm itself.
 *
 * Alarm API: setAndAllowWhileIdle — inexact, fires through Doze, needs no
 * SCHEDULE_EXACT_ALARM (not pre-granted on Android 14+). Minutes of drift are
 * fine for a nudge.
 */
object ReminderScheduler {
    const val CHANNEL_ID = "streak_reminder"
    const val NOTIFICATION_ID = 42
    const val ACTION_LOG_NOW = "expo.modules.habittile.ACTION_LOG_NOW"

    private const val RC_ALARM = 1001
    private const val RC_LOG_NOW = 1003
    private const val RC_OPEN_APP = 1004
    private const val ACCENT = 0xFF4F46E5.toInt()
    private const val PI_FLAGS = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE

    /** (Re)arm the next alarm, or cancel everything if the reminder is off. Returns the trigger time (0 if off). */
    fun scheduleNext(ctx: Context, now: Long = System.currentTimeMillis()): Long {
        val app = ctx.applicationContext
        if (!HabitStore.reminderEnabled(app)) {
            cancelAll(app)
            return 0L
        }
        val at = nextTriggerAt(app, now)
        try {
            alarmManager(app).setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, alarmPendingIntent(app))
        } catch (_: Throwable) {
            // Best effort; the next touchpoint will try again.
        }
        return at
    }

    /**
     * Today at the configured HH:MM if that is still ahead, else tomorrow.
     * If today already needs nothing (logged / rest day) skip straight to
     * tomorrow — an optimisation only; the fire-time check is the authority.
     */
    fun nextTriggerAt(ctx: Context, now: Long = System.currentTimeMillis()): Long {
        val cal = Calendar.getInstance().apply {
            timeInMillis = now
            set(Calendar.HOUR_OF_DAY, HabitStore.reminderHour(ctx))
            set(Calendar.MINUTE, HabitStore.reminderMinute(ctx))
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }
        val nothingLeftToday = HabitStore.loggedToday(ctx, now) || HabitStore.isRestDay(ctx, now)
        if (cal.timeInMillis <= now + 60_000L || nothingLeftToday) {
            cal.add(Calendar.DAY_OF_YEAR, 1)
        }
        return cal.timeInMillis
    }

    fun cancelAll(ctx: Context) {
        try {
            alarmManager(ctx).cancel(alarmPendingIntent(ctx))
        } catch (_: Throwable) {
        }
        cancelNotification(ctx)
    }

    /** The decide-at-fire-time check. Always re-arms afterwards. */
    fun onAlarmFired(ctx: Context, now: Long = System.currentTimeMillis()) {
        val app = ctx.applicationContext
        val streak = HabitStore.currentStreak(app, now)
        val atRisk = streak > 0 &&
            !HabitStore.loggedToday(app, now) &&
            !HabitStore.isRestDay(app, now)
        if (atRisk && notificationsAllowed(app)) {
            postNotification(app, streak, now)
        }
        scheduleNext(app, now)
    }

    fun postNotification(ctx: Context, streak: Int, now: Long = System.currentTimeMillis()) {
        ensureChannel(ctx)
        val left = HabitStore.hoursLeftToday(now)
        val tail = if (left <= 1.0) "last hour" else "${left.toInt()}h left"
        val text = "$streak day streak · $tail"

        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(ctx, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(ctx).setPriority(Notification.PRIORITY_DEFAULT)
        }
        builder
            .setSmallIcon(R.drawable.ic_habit_notification)
            .setColor(ACCENT)
            .setContentTitle("Streak at risk")
            .setContentText(text)
            .setContentIntent(openAppPendingIntent(ctx))
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .addAction(
                Notification.Action.Builder(
                    Icon.createWithResource(ctx, R.drawable.ic_habit_notification),
                    "Log now",
                    logNowPendingIntent(ctx)
                ).build()
            )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // A reminder about *today* must not survive into tomorrow.
            builder.setTimeoutAfter(HabitStore.msUntilLocalMidnight(now))
        }
        notificationManager(ctx).notify(NOTIFICATION_ID, builder.build())
    }

    fun cancelNotification(ctx: Context) {
        notificationManager(ctx).cancel(NOTIFICATION_ID)
    }

    /** Idempotent; safe to call before every post. */
    fun ensureChannel(ctx: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = notificationManager(ctx)
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Streak reminders",
            NotificationManager.IMPORTANCE_DEFAULT
        ).apply {
            description = "A nudge in the evening when a live streak is still unlogged."
        }
        nm.createNotificationChannel(channel)
    }

    /** App-level toggle AND (26+) the channel not being blocked by the user. */
    fun notificationsAllowed(ctx: Context): Boolean {
        val nm = notificationManager(ctx)
        if (!nm.areNotificationsEnabled()) return false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = nm.getNotificationChannel(CHANNEL_ID) ?: return true // not created yet
            return ch.importance != NotificationManager.IMPORTANCE_NONE
        }
        return true
    }

    /** Ask the system to re-run the tile's onStartListening so it reflects a log made elsewhere. */
    fun refreshTile(ctx: Context) {
        try {
            TileService.requestListeningState(
                ctx.applicationContext,
                ComponentName(ctx.applicationContext, HabitTileService::class.java)
            )
        } catch (_: Throwable) {
            // The tile may not be added; that's fine.
        }
    }

    // ---- internals ----

    private fun alarmManager(ctx: Context) =
        ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager

    private fun notificationManager(ctx: Context) =
        ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    private fun alarmPendingIntent(ctx: Context): PendingIntent {
        val intent = Intent(ctx, ReminderAlarmReceiver::class.java)
        return PendingIntent.getBroadcast(ctx, RC_ALARM, intent, PI_FLAGS)
    }

    private fun logNowPendingIntent(ctx: Context): PendingIntent {
        val intent = Intent(ctx, ReminderActionReceiver::class.java).setAction(ACTION_LOG_NOW)
        return PendingIntent.getBroadcast(ctx, RC_LOG_NOW, intent, PI_FLAGS)
    }

    private fun openAppPendingIntent(ctx: Context): PendingIntent? {
        val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: return null
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        return PendingIntent.getActivity(ctx, RC_OPEN_APP, launch, PI_FLAGS)
    }
}
