package expo.modules.habittile

import android.content.Context

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
    private const val KEY_REST_DAYS = "rest_days"         // comma-separated local day indices
    private const val KEY_UNDO_LAST = "undo_last_logged_at"
    private const val KEY_UNDO_STREAK = "undo_streak_raw"
    private const val KEY_UNDO_REST = "undo_rest_today"
    private const val KEY_HEARTBEAT = "heartbeat_at"     // last time the app process was alive
    private const val KEY_REMINDER_ENABLED = "reminder_enabled"
    private const val KEY_REMINDER_HOUR = "reminder_hour"
    private const val KEY_REMINDER_MINUTE = "reminder_minute"

    const val DEFAULT_REMINDER_HOUR = 20
    const val DEFAULT_REMINDER_MINUTE = 0

    private fun prefs(ctx: Context) =
        ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private val lock = Any()

    private fun load(ctx: Context): HabitLogic.Habit {
        val p = prefs(ctx)
        val rest = HashSet<Long>()
        p.getString(KEY_REST_DAYS, "")?.split(',')?.forEach { it.toLongOrNull()?.let(rest::add) }
        val legacy = p.getLong(KEY_REST_DAY_AT, 0L)
        if (legacy > 0L) rest.add(HabitLogic.localDay(legacy))
        return HabitLogic.Habit(p.getLong(KEY_LAST_LOGGED, 0L), p.getInt(KEY_STREAK, 0), rest)
    }

    private fun loadUndo(ctx: Context): HabitLogic.Undo? {
        val p = prefs(ctx)
        if (!p.contains(KEY_UNDO_LAST)) return null
        return HabitLogic.Undo(
            p.getLong(KEY_UNDO_LAST, 0L), p.getInt(KEY_UNDO_STREAK, 0), p.getBoolean(KEY_UNDO_REST, false)
        )
    }

    /** commit() (not apply()) so other processes reading the prefs see the write immediately. */
    private fun save(ctx: Context, h: HabitLogic.Habit, undo: HabitLogic.Undo?) {
        val e = prefs(ctx).edit()
            .putLong(KEY_LAST_LOGGED, h.lastLoggedAt)
            .putInt(KEY_STREAK, h.rawStreak)
            .putString(KEY_REST_DAYS, h.restDays.sorted().joinToString(","))
            .remove(KEY_REST_DAY_AT)
        if (undo != null) {
            e.putLong(KEY_UNDO_LAST, undo.lastLoggedAt)
                .putInt(KEY_UNDO_STREAK, undo.rawStreak)
                .putBoolean(KEY_UNDO_REST, undo.restToday)
        } else {
            e.remove(KEY_UNDO_LAST).remove(KEY_UNDO_STREAK).remove(KEY_UNDO_REST)
        }
        e.commit()
    }

    fun lastLoggedAt(ctx: Context): Long = prefs(ctx).getLong(KEY_LAST_LOGGED, 0L)

    fun loggedToday(ctx: Context, now: Long = System.currentTimeMillis()): Boolean =
        HabitLogic.loggedToday(load(ctx), now)

    /** Streak derived on read; rest days preserve it. The stored value is never mutated here. */
    fun currentStreak(ctx: Context, now: Long = System.currentTimeMillis()): Int =
        HabitLogic.currentStreak(load(ctx), now)

    /** Log the habit for "now". Idempotent within the same local day. */
    fun logHabit(ctx: Context, now: Long = System.currentTimeMillis()) = synchronized(lock) {
        val r = HabitLogic.log(load(ctx), now)
        if (r.undo != null) save(ctx, r.habit, r.undo)
    }

    /** Undo today's log, restoring the previous values. Returns true if something was undone. */
    fun unlogToday(ctx: Context, now: Long = System.currentTimeMillis()): Boolean = synchronized(lock) {
        val h = load(ctx)
        if (!HabitLogic.loggedToday(h, now)) return false
        val undo = loadUndo(ctx) ?: return false
        save(ctx, HabitLogic.unlog(h, undo, now), null)
        true
    }

    fun isRestDay(ctx: Context, now: Long = System.currentTimeMillis()): Boolean =
        HabitLogic.isRestDay(load(ctx), now)

    fun setRestDay(ctx: Context, rest: Boolean, now: Long = System.currentTimeMillis()) = synchronized(lock) {
        val h = HabitLogic.setRestDay(load(ctx), rest, now)
        // Keep any pending undo: restoring a rest mark is handled by the Undo record.
        save(ctx, h, loadUndo(ctx))
    }

    /** Hours until local midnight (real elapsed hours, DST-safe). */
    fun hoursLeftToday(now: Long = System.currentTimeMillis()): Double = HabitLogic.hoursLeftToday(now)

    fun subtitle(ctx: Context, now: Long = System.currentTimeMillis()): String =
        HabitLogic.subtitle(load(ctx), now)

    /** Milliseconds from [now] until the next local midnight (>= 0). */
    fun msUntilLocalMidnight(now: Long = System.currentTimeMillis()): Long =
        HabitLogic.msUntilLocalMidnight(now)

    // ---- Streak-at-risk reminder settings ----
    // Only the *settings* live here. Whether a reminder actually fires is
    // decided at alarm time by reading this store (see ReminderScheduler), so
    // nothing about the reminder is ever pre-computed or maintained on a timer.

    fun reminderEnabled(ctx: Context): Boolean =
        prefs(ctx).getBoolean(KEY_REMINDER_ENABLED, false)

    fun reminderHour(ctx: Context): Int =
        prefs(ctx).getInt(KEY_REMINDER_HOUR, DEFAULT_REMINDER_HOUR).coerceIn(0, 23)

    fun reminderMinute(ctx: Context): Int =
        prefs(ctx).getInt(KEY_REMINDER_MINUTE, DEFAULT_REMINDER_MINUTE).coerceIn(0, 59)

    fun setReminder(ctx: Context, enabled: Boolean, hour: Int, minute: Int) {
        prefs(ctx).edit()
            .putBoolean(KEY_REMINDER_ENABLED, enabled)
            .putInt(KEY_REMINDER_HOUR, hour.coerceIn(0, 23))
            .putInt(KEY_REMINDER_MINUTE, minute.coerceIn(0, 59))
            .commit()
    }

    fun writeHeartbeat(ctx: Context, now: Long = System.currentTimeMillis()) {
        prefs(ctx).edit().putLong(KEY_HEARTBEAT, now).apply()
    }

    fun heartbeatGapMs(ctx: Context, now: Long = System.currentTimeMillis()): Long {
        val hb = prefs(ctx).getLong(KEY_HEARTBEAT, 0L)
        return if (hb <= 0L) 0L else now - hb
    }
}
