package expo.modules.habittile

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * The notification's "Log now" action. Logs through the same [HabitStore] the
 * tile and the app use, so the three surfaces can never disagree. Never starts
 * an activity (Android 12 notification-trampoline rule).
 */
class ReminderActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != ReminderScheduler.ACTION_LOG_NOW) return
        val app = context.applicationContext
        HabitStore.logHabit(app)
        ReminderScheduler.cancelNotification(app)
        ReminderScheduler.refreshTile(app)
        ReminderScheduler.scheduleNext(app)
    }
}
