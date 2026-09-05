package expo.modules.habittile

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Fired by AlarmManager at the reminder time. Does nothing but hand off to
 * [ReminderScheduler.onAlarmFired], which decides — by reading the store — whether
 * anything is actually at risk. A few SharedPreferences reads and one notify()
 * is well inside the receiver budget, so no goAsync() is needed.
 */
class ReminderAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        ReminderScheduler.onAlarmFired(context.applicationContext)
    }
}
