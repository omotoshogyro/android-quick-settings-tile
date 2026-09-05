package expo.modules.habittile

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Alarms are cleared on reboot and can drift on manual time / timezone
 * changes. All four actions below are on the Android 8+ implicit-broadcast
 * exemption list, so manifest registration still works. When the reminder is
 * disabled, [ReminderScheduler.scheduleNext] is a cancel, so this is harmless.
 */
class ReminderBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        when (intent?.action) {
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED,
            Intent.ACTION_TIME_CHANGED,
            Intent.ACTION_TIMEZONE_CHANGED -> ReminderScheduler.scheduleNext(context.applicationContext)
        }
    }
}
