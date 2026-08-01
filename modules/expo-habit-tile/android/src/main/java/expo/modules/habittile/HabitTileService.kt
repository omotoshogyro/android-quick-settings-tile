package expo.modules.habittile

import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

/**
 * The Quick Settings Tile. The system instantiates this — it can run while the
 * app's JS/React process is dead, which is exactly why all state lives in
 * [HabitStore] (SharedPreferences) rather than in memory.
 *
 * - onStartListening() runs every time the shade opens, so the subtitle is
 *   recomputed fresh (a nudge that reads differently at lunchtime vs 11pm).
 * - onClick() logs the habit in one tap, zero thought.
 */
class HabitTileService : TileService() {

    override fun onStartListening() {
        super.onStartListening()
        render()
    }

    override fun onClick() {
        super.onClick()
        val log = Runnable {
            HabitStore.logHabit(applicationContext)
            render()
        }
        // If a secure keyguard is up, prompt to unlock before mutating state.
        if (isSecure) unlockAndRun(log) else log.run()
    }

    private fun render() {
        val tile = qsTile ?: return
        val ctx = applicationContext
        tile.state = when {
            HabitStore.isRestDay(ctx) -> Tile.STATE_UNAVAILABLE // nothing to do today
            HabitStore.loggedToday(ctx) -> Tile.STATE_ACTIVE     // logged
            else -> Tile.STATE_INACTIVE                          // still pending
        }
        tile.label = "Log habit"
        val subtitle = HabitStore.subtitle(ctx)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            tile.subtitle = subtitle
        }
        tile.contentDescription = "Log habit — $subtitle"
        tile.updateTile()
    }
}
