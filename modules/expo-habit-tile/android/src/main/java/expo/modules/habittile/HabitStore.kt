package expo.modules.habittile

import android.content.Context
import java.util.Calendar
import java.util.concurrent.TimeUnit

/**
 * Single source of truth for the habit, shared by the Tile (instantiated by the
 * system, possibly while the app process is dead) and the Expo module
 * (instantiated inside the app). Backed by SharedPreferences so both see the
 * same data.
 *
 * The core idea from the design discussion: there is no reliable "midnight" on
 * Android, so we NEVER reset the streak on a timer. The stored number is only
 * ever interpreted — [currentStreak] derives the lapse from the last-logged
 * timestamp every time anyone asks. That way the app and the tile can never
 * disagree, and being killed at any moment is harmless.
 */
object HabitStore {
    private const val PREFS = "habit_tile_prefs"
    private const val KEY_LAST_LOGGED = "last_logged_at" // epoch ms, 0 = never
    private const val KEY_STREAK = "streak_raw"          // streak as of the last log
    private const val KEY_REST_DAY_AT = "rest_day_at"    // epoch ms of the day marked as rest
    private const val KEY_HEARTBEAT = "heartbeat_at"     // last time the app process was alive

    private fun prefs(ctx: Context) =
        ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** Local calendar-day index (days since epoch in the device's time zone). */
    private fun localDay(millis: Long): Long {
        val cal = Calendar.getInstance().apply { timeInMillis = millis }
        val offset = cal.get(Calendar.ZONE_OFFSET) + cal.get(Calendar.DST_OFFSET)
        return TimeUnit.MILLISECONDS.toDays(millis + offset)
    }

    fun lastLoggedAt(ctx: Context): Long = prefs(ctx).getLong(KEY_LAST_LOGGED, 0L)

    fun loggedToday(ctx: Context, now: Long = System.currentTimeMillis()): Boolean {
        val last = lastLoggedAt(ctx)
        return last > 0L && localDay(last) == localDay(now)
    }

    /**
     * Streak derived on read. Alive if logged today or yesterday; lapsed (0) once
     * a full day has been missed. The stored value is never mutated here.
     */
    fun currentStreak(ctx: Context, now: Long = System.currentTimeMillis()): Int {
        val last = lastLoggedAt(ctx)
        if (last <= 0L) return 0
        val raw = prefs(ctx).getInt(KEY_STREAK, 0)
        return when (localDay(now) - localDay(last)) {
            in Long.MIN_VALUE..0L -> raw // logged today (or clock skew)
            1L -> raw                    // logged yesterday, still continuable today
            else -> 0                    // missed a full day -> lapsed
        }
    }

    /** Log the habit for "now". Idempotent within the same local day. */
    fun logHabit(ctx: Context, now: Long = System.currentTimeMillis()) {
        val last = lastLoggedAt(ctx)
        val today = localDay(now)
        if (last > 0L && localDay(last) == today) return // already logged today
        val alive = currentStreak(ctx, now) // raw if continuable, 0 if lapsed/never
        val newStreak =
            if (last > 0L && today - localDay(last) == 1L) alive + 1 else 1
        prefs(ctx).edit()
            .putLong(KEY_LAST_LOGGED, now)
            .putInt(KEY_STREAK, newStreak)
            .putLong(KEY_REST_DAY_AT, 0L) // logging clears any rest-day mark
            .apply()
    }

    fun isRestDay(ctx: Context, now: Long = System.currentTimeMillis()): Boolean {
        val restAt = prefs(ctx).getLong(KEY_REST_DAY_AT, 0L)
        return restAt > 0L && localDay(restAt) == localDay(now)
    }

    fun setRestDay(ctx: Context, rest: Boolean, now: Long = System.currentTimeMillis()) {
        prefs(ctx).edit().putLong(KEY_REST_DAY_AT, if (rest) now else 0L).apply()
    }

    /** Fractional hours until local midnight. */
    fun hoursLeftToday(now: Long = System.currentTimeMillis()): Double {
        val cal = Calendar.getInstance().apply { timeInMillis = now }
        val h = cal.get(Calendar.HOUR_OF_DAY)
        val m = cal.get(Calendar.MINUTE)
        return 24.0 - (h + m / 60.0)
    }

    /**
     * The contextual subtitle, computed fresh on every read — so the same stored
     * state reads differently depending on when the shade happens to open.
     */
    fun subtitle(ctx: Context, now: Long = System.currentTimeMillis()): String {
        if (isRestDay(ctx, now)) return "Rest day"
        val streak = currentStreak(ctx, now)
        if (loggedToday(ctx, now)) {
            return if (streak > 0) "$streak day streak · done" else "Done today"
        }
        if (streak <= 0) return "Start your streak"
        val left = hoursLeftToday(now)
        val tail = when {
            left <= 1.0 -> "last hour"
            left <= 5.0 -> "${left.toInt()}h left"
            else -> "not yet"
        }
        return "$streak day streak · $tail"
    }

    fun writeHeartbeat(ctx: Context, now: Long = System.currentTimeMillis()) {
        prefs(ctx).edit().putLong(KEY_HEARTBEAT, now).apply()
    }

    fun heartbeatGapMs(ctx: Context, now: Long = System.currentTimeMillis()): Long {
        val hb = prefs(ctx).getLong(KEY_HEARTBEAT, 0L)
        return if (hb <= 0L) 0L else now - hb
    }
}
