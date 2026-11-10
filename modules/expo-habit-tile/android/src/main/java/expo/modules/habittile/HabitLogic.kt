package expo.modules.habittile

import java.util.Calendar
import java.util.TimeZone

/**
 * Pure, Android-free habit/streak/day logic so it can be unit-tested on the JVM.
 * Time zone is injectable. (java.util is used instead of java.time on purpose:
 * module minSdk is 24 and java.time needs API 26 or core-library desugaring.
 * [TimeZone.getOffset] and zoned [Calendar] arithmetic are DST-correct.)
 */
object HabitLogic {
    private const val DAY_MS = 86_400_000L
    private const val HOUR_MS = 3_600_000.0
    private const val REST_DAY_RETENTION = 60L

    /** [rawStreak] is the streak as of [lastLoggedAt]; [restDays] are local day indices. */
    data class Habit(
        val lastLoggedAt: Long = 0L,
        val rawStreak: Int = 0,
        val restDays: Set<Long> = emptySet(),
    )

    /** What to restore if today's log is undone. */
    data class Undo(val lastLoggedAt: Long, val rawStreak: Int, val restToday: Boolean)

    data class LogResult(val habit: Habit, val undo: Undo?)

    /** Local calendar-day index (days since epoch in [zone]). */
    fun localDay(millis: Long, zone: TimeZone = TimeZone.getDefault()): Long =
        Math.floorDiv(millis + zone.getOffset(millis), DAY_MS)

    fun loggedToday(h: Habit, now: Long, zone: TimeZone = TimeZone.getDefault()): Boolean =
        h.lastLoggedAt > 0L && localDay(h.lastLoggedAt, zone) == localDay(now, zone)

    fun isRestDay(h: Habit, now: Long, zone: TimeZone = TimeZone.getDefault()): Boolean =
        localDay(now, zone) in h.restDays

    /** Every full day strictly between the last log and today is a rest day. */
    private fun continuable(h: Habit, today: Long, zone: TimeZone): Boolean {
        if (h.lastLoggedAt <= 0L) return false
        val lastDay = localDay(h.lastLoggedAt, zone)
        if (today - lastDay <= 1L) return true
        return (lastDay + 1 until today).all { it in h.restDays }
    }

    /** Streak derived on read; rest days without a log preserve it. */
    fun currentStreak(h: Habit, now: Long, zone: TimeZone = TimeZone.getDefault()): Int =
        if (continuable(h, localDay(now, zone), zone)) h.rawStreak else 0

    fun log(h: Habit, now: Long, zone: TimeZone = TimeZone.getDefault()): LogResult {
        if (loggedToday(h, now, zone)) return LogResult(h, null)
        val today = localDay(now, zone)
        val newStreak =
            if (h.lastLoggedAt > 0L && today - localDay(h.lastLoggedAt, zone) >= 1L &&
                continuable(h, today, zone)
            ) h.rawStreak + 1 else 1
        val undo = Undo(h.lastLoggedAt, h.rawStreak, today in h.restDays)
        // Logging clears any rest-day mark for today.
        return LogResult(Habit(now, newStreak, prune(h.restDays - today, today)), undo)
    }

    /** Restore pre-log values. No-op unless logged today and [undo] is present. */
    fun unlog(h: Habit, undo: Undo?, now: Long, zone: TimeZone = TimeZone.getDefault()): Habit {
        if (undo == null || !loggedToday(h, now, zone)) return h
        val today = localDay(now, zone)
        val rest = if (undo.restToday) h.restDays + today else h.restDays
        return Habit(undo.lastLoggedAt, undo.rawStreak, rest)
    }

    fun setRestDay(h: Habit, rest: Boolean, now: Long, zone: TimeZone = TimeZone.getDefault()): Habit {
        val today = localDay(now, zone)
        val days = if (rest) h.restDays + today else h.restDays - today
        return h.copy(restDays = prune(days, today))
    }

    private fun prune(days: Set<Long>, today: Long) = days.filter { it >= today - REST_DAY_RETENTION }.toSet()

    /** Milliseconds from [now] to the next local midnight (DST-correct, >= 0). */
    fun msUntilLocalMidnight(now: Long, zone: TimeZone = TimeZone.getDefault()): Long {
        val cal = Calendar.getInstance(zone).apply {
            timeInMillis = now
            add(Calendar.DAY_OF_YEAR, 1)
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }
        return (cal.timeInMillis - now).coerceAtLeast(0L)
    }

    /** Real hours until local midnight (23 or 25 on DST-change days). */
    fun hoursLeftToday(now: Long, zone: TimeZone = TimeZone.getDefault()): Double =
        msUntilLocalMidnight(now, zone) / HOUR_MS

    fun subtitle(h: Habit, now: Long, zone: TimeZone = TimeZone.getDefault()): String {
        if (isRestDay(h, now, zone)) return "Rest day"
        val streak = currentStreak(h, now, zone)
        if (loggedToday(h, now, zone)) {
            return if (streak > 0) "$streak day streak · done" else "Done today"
        }
        if (streak <= 0) return "Start your streak"
        val left = hoursLeftToday(now, zone)
        val tail = when {
            left <= 1.0 -> "last hour"
            left <= 5.0 -> "${left.toInt()}h left"
            else -> "not yet"
        }
        return "$streak day streak · $tail"
    }
}
