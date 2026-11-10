package expo.modules.habittile

import expo.modules.habittile.HabitLogic.Habit
import java.util.TimeZone
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HabitLogicTest {
    private val utc = TimeZone.getTimeZone("UTC")
    private val ny = TimeZone.getTimeZone("America/New_York")
    private val day = 86_400_000L
    private val noon = 12 * 3_600_000L // noon UTC on day 0 offset

    private fun at(d: Int) = d * day + noon

    private fun logOn(h: Habit, d: Int, zone: TimeZone = utc) = HabitLogic.log(h, at(d), zone).habit

    @Test fun consecutiveDaysBuildStreak() {
        var h = Habit()
        for (d in 100..102) h = logOn(h, d)
        assertEquals(3, HabitLogic.currentStreak(h, at(102), utc))
        assertEquals(3, HabitLogic.currentStreak(h, at(103), utc))
        assertEquals(0, HabitLogic.currentStreak(h, at(104), utc))
    }

    @Test fun logIsIdempotentWithinDay() {
        val h = logOn(Habit(), 100)
        val r = HabitLogic.log(h, at(100) + 1000, utc)
        assertEquals(h, r.habit)
        assertEquals(null, r.undo)
    }

    @Test fun restDayWithoutLogPreservesStreak() {
        var h = logOn(logOn(Habit(), 100), 101)
        h = HabitLogic.setRestDay(h, true, at(102), utc)
        assertEquals(2, HabitLogic.currentStreak(h, at(103), utc))
        h = logOn(h, 103)
        assertEquals(3, HabitLogic.currentStreak(h, at(103), utc))
    }

    @Test fun unmarkedMissedDayStillBreaks() {
        var h = logOn(Habit(), 100)
        h = HabitLogic.setRestDay(h, true, at(102), utc) // 101 is NOT rest
        assertEquals(0, HabitLogic.currentStreak(h, at(103), utc))
        assertEquals(1, logOn(h, 103).rawStreak)
    }

    @Test fun loggingOnRestDayClearsMark() {
        var h = HabitLogic.setRestDay(logOn(Habit(), 100), true, at(101), utc)
        h = logOn(h, 101)
        assertFalse(HabitLogic.isRestDay(h, at(101), utc))
        assertEquals(2, h.rawStreak)
    }

    @Test fun undoRestoresPreviousValues() {
        val before = HabitLogic.setRestDay(logOn(Habit(), 100), true, at(101), utc)
        val r = HabitLogic.log(before, at(101), utc)
        assertTrue(HabitLogic.loggedToday(r.habit, at(101), utc))
        val back = HabitLogic.unlog(r.habit, r.undo, at(101), utc)
        assertEquals(before, back)
    }

    @Test fun undoIsNoOpOnAnotherDay() {
        val r = HabitLogic.log(Habit(), at(100), utc)
        assertEquals(r.habit, HabitLogic.unlog(r.habit, r.undo, at(101), utc))
    }

    @Test fun localDayUsesZone() {
        val t = 5 * 3_600_000L + 200 * day // 05:00 UTC = previous day in New York
        assertEquals(200L, HabitLogic.localDay(t, utc))
        assertEquals(199L, HabitLogic.localDay(t, ny))
    }

    @Test fun hoursLeftIsDstSafe() {
        // 2024-03-10 00:00 New York is 05:00Z; that day has 23 hours.
        val start = 1710046800000L
        assertEquals(23.0, HabitLogic.hoursLeftToday(start, ny), 0.001)
        // 2024-11-03 has 25 hours.
        assertEquals(25.0, HabitLogic.hoursLeftToday(1730606400000L, ny), 0.001)
    }
}
