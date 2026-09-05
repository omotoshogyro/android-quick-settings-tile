# Native Projects — Build Notes

A running summary of the native Android/iOS projects we're building, distilled from the design chat. Each project gets its own section with what it is, the platform surfaces it uses, the specific design decisions from the chat, and where it sits in the build order.

> **Status:** The **Quick Settings Tile** (habit tracker) is being built first — see its section below. The full multi-project list is being supplied by the user and the remaining sections will be filled in as we go (placeholders at the bottom).

---

## Cross-cutting Android platform notes

These apply to **every** background-capable Android project below. They're the part that surprises people, so they live at the top.

### The one principle: you don't control when your code runs
There is no reliable "midnight" on Android. You cannot schedule a job at 00:00 and count on it firing — Doze defers it, App Standby throttles it, OEM battery managers may kill the process, and the process might not even exist. So:

- **Derive state from a timestamp on read, don't maintain it on a timer.** Store the raw event (e.g. `lastLoggedAt`) and *interpret* it whenever anyone asks, rather than "correcting" it on a schedule. (In the Tile, `HabitStore.currentStreak()` computes the lapse from the timestamp every read; the stored number is never mutated by a timer.)
- **Assume you will be killed at any moment.** Persist, then reconcile on next launch. A design that survives being killed needs no exemption.
- **Never let two readers disagree.** If JS reads the raw value and the tile reads a corrected one, you'll chase a "sync bug" that's really a scheduling assumption. Both read the same derived value from the same store.

### Layer 1 — AOSP (documented, testable, consistent)
- **Doze** (device-level): screen off + unplugged (+ stationary for deep Doze) → network cut, wakelocks ignored, jobs/alarms/syncs deferred; periodic maintenance windows that space out the longer it sits. **Light Doze** (Android 7+) doesn't need stationary, so it hits a phone in a pocket.
- **App Standby Buckets** (Android 9+): Active → Working set → Frequent → Rare → **Restricted** (Android 12+ floor: ~one job batch/day). The user or the system can drop you to Restricted.
- **Background execution limits** (Android 8): no starting background services while idle; most implicit broadcasts gone → use WorkManager / foreground services.
- **Foreground services** (the sanctioned escape, steadily narrowed): API 34+ requires a declared **type** + matching permission; Android 15+ gives `dataSync`/`mediaProcessing` **6h/24h** then `onTimeout()`; Android 16 subjects FGS-started jobs to normal quotas and blocks some `BOOT_COMPLETED` FGS launches; `setImportantWhileForeground` is a no-op.
- **What still gets through:** high-priority FCM, user-granted battery-optimization exemption, **CompanionDeviceManager** associations (`REQUEST_COMPANION_RUN_IN_BACKGROUND` — the proper mechanism for a paired BLE tracker), and `setAlarmClock` / `setExactAndAllowWhileIdle` (sparingly).
- `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` **only** exempts Layer 1 — and Play restricts which app categories may request it.

### Layer 2 — OEM skins (undocumented, untestable remotely, the real killer)
AOSP says nothing about power management, so vendors bolt on their own (battery life is a headline spec):
- **Autostart whitelists** — your app can't be started at all (no boot receiver, no alarm, no FCM wake) unless the user enabled autostart. Xiaomi/Oppo/Vivo/Huawei; MIUI 14 made it a per-app background-start permission.
- **Swipe-to-kill** — clearing from recents terminates the process and cancels its alarms/jobs (not a kill on stock Android).
- **Foreground-service termination** — some skins (e.g. EMUI) kill even FGS, breaking the "persistent notification is a contract" promise.
- **Settings that don't survive** — exemptions reset after system updates (Samsung, Xiaomi), silently breaking a user who set it up months ago.

### The practical playbook
1. **Design so it doesn't matter** (derive-from-timestamp, reconcile on launch).
2. **Ask for the AOSP exemption** if you qualify: `PowerManager.isIgnoringBatteryOptimizations()` → `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` (or open the settings list, which is always permitted).
3. **Route the user to the vendor screen** — read `Build.MANUFACTURER`, fetch `https://dontkillmyapp.com/api/v2/{manufacturer}.json` at runtime and render its instructions (beats hardcoding component names that break on the next firmware).
4. **Detect the failure** — write a heartbeat timestamp; on next foreground, if the gap is much larger than expected, re-show the setup prompt (also catches post-update resets).
5. **Test properly:**
   ```bash
   adb shell dumpsys battery unplug
   adb shell dumpsys deviceidle force-idle      # deep doze now
   adb shell dumpsys deviceidle step            # advance one state
   adb shell am set-standby-bucket <pkg> restricted
   adb shell am get-standby-bucket <pkg>
   adb shell dumpsys battery reset
   ```
   The **OEM layer is not reproducible from adb or on a Pixel** — the only test is a physical device with that skin.

### Market note
For a Nigeria / West-Africa audience, **Transsion** (Tecno, Infinix; HiOS/XOS skins) holds a very large share and is among the most aggressive. A Pixel emulator tells you nothing about it — budget for a physical Tecno/Infinix on the desk, plus an onboarding + re-prompt path, not just a manifest entry.

---

## 1. Quick Settings Tile — one-tap habit logger  *(Android · building now)*

### What it is
A tile in the notification shade that logs a daily habit in **one gesture, zero thought**, with a **contextual subtitle** that reads differently depending on when you glance at it ("4 day streak · not yet" at lunch, "· 2h left" in the evening, "· last hour" after 11pm), and a streak that's **correct whenever it's asked** — never reset on a timer.

### Platform surfaces / APIs
- `TileService` (`onStartListening`, `onClick`, `Tile.STATE_ACTIVE/INACTIVE/UNAVAILABLE`, `updateTile`, `subtitle` on API 29+), declared with `BIND_QUICK_SETTINGS_TILE` + the `QS_TILE` intent-filter.
- Built as a **local Expo native module** (Kotlin) so the RN app and the system-instantiated tile share one `SharedPreferences`-backed store.

### Design decisions (from the chat)
- **`onStartListening()` recomputes the subtitle fresh** each shade open — computed, not stored, so it can nudge ("streak breaks in 4 hrs" at 8pm).
- **`STATE_UNAVAILABLE`** for a rest day / already-logged — communicating "nothing to do here" beats a toggle that lies.
- **`currentStreak()` derives the lapse on read**; `getState()` returns the corrected value so the app and tile never disagree.
- Onboarding handles both battery layers: AOSP exemption check/route + OEM autostart routing (DontKillMyApp) + a heartbeat that re-prompts if it detects a kill.
- Future surface that shares the same store: a **home-screen widget** (streak grid — great display, poor input). Same architecture, three surfaces.

### Surface 2 — the streak-at-risk reminder *(built)*
A notification in the evening, **only** when a live streak is still unlogged and it isn't a rest day. Pure native (Kotlin in the same module) because the common user never opens the app — they log from the tile — so JS-scheduled notifications (`expo-notifications`) could neither be cancelled by the tile nor reconciled while JS is dead.

- **The alarm is a wake-up, not a decision.** `ReminderScheduler.onAlarmFired()` reads `HabitStore` at fire time (`currentStreak > 0 && !loggedToday && !isRestDay && notificationsAllowed`) and is silent otherwise. Nothing is pre-computed, so a tile log at 3pm makes the 8pm alarm a no-op with zero coordination.
- **Inexact by design.** `AlarmManager.setAndAllowWhileIdle(RTC_WAKEUP)` fires through Doze, needs no `SCHEDULE_EXACT_ALARM` (not pre-granted on 14+, Play-policed) — minutes of drift are fine for a nudge. `setWindow` would be deferred to a Doze maintenance window (phone in pocket at 8pm), so it's the worse fit.
- **One idempotent re-arm entry point**, `ReminderScheduler.scheduleNext()`, called from every touchpoint: tile `onClick`/`onStartListening` (self-heals an alarm an OEM force-stop dropped), JS `logHabit`/`setRestDay`/`setReminder`, `OnActivityEntersForeground`, the alarm itself, and a receiver for `BOOT_COMPLETED` / `MY_PACKAGE_REPLACED` / `TIME_SET` / `TIMEZONE_CHANGED` (all on the implicit-broadcast exemption list).
- **"Log now" is a BroadcastReceiver** that calls the same `HabitStore.logHabit()` — tile, app and notification can never disagree — then cancels the notification and asks the tile to re-render. No activity trampoline.
- **`setTimeoutAfter(msUntilLocalMidnight)`** so a reminder about *today* never survives into tomorrow.
- Settings (`reminder_enabled`, `reminder_hour`, `reminder_minute`) live in the same prefs file; default 20:00, off until the user grants `POST_NOTIFICATIONS` (13+) — granting switches it on.

### Where it lives (this repo)
- `modules/expo-habit-tile/` — the local module:
  - `expo-module.config.json` (`platforms: ["android"]`, FQCN in `android.modules`)
  - `android/src/main/java/expo/modules/habittile/`
    - `HabitStore.kt` — the derive-from-timestamp store (the heart of it) + reminder settings
    - `HabitTileService.kt` — the tile (subtitle + one-tap log + 3 states; re-arms the reminder)
    - `ExpoHabitTileModule.kt` — JS bridge + battery/OEM escape hatches + reminder settings + `POST_NOTIFICATIONS` permission (`AsyncFunction`s via Expo's `Permissions` helper)
    - `ReminderScheduler.kt` — arm/cancel the alarm, decide-at-fire-time, post/cancel the notification, channel
    - `ReminderAlarmReceiver.kt` — alarm → `onAlarmFired`
    - `ReminderActionReceiver.kt` — the "Log now" action
    - `ReminderBootReceiver.kt` — re-arm after boot / update / time / timezone change
  - `android/src/main/AndroidManifest.xml` — the tile `<service>`, the three `<receiver>`s, `POST_NOTIFICATIONS` + `RECEIVE_BOOT_COMPLETED` (manifest-merged)
  - `android/src/main/res/drawable/ic_habit_tile.xml` — tile icon; `ic_habit_notification.xml` — untinted small icon
  - `index.ts` — typed JS API via `requireOptionalNativeModule` (degrades gracefully pre-rebuild)
- `App.tsx` — streak screen, one-tap log, rest-day toggle, streak-reminder card (permission → toggle → preset chips + ±15m stepper), battery/autostart onboarding, heartbeat.

### Verify
- `expo run:android` onto a Pixel AVD → add the tile via the shade editor → tap logs & increments the streak → reopen shade → subtitle recomputed.
- Doze/standby via the adb playbook above; confirm the streak still derives correctly after simulated idle (proves the no-timer design).
- OEM layer only on a physical Transsion/Xiaomi device (not the Pixel).
- **Reminder:**
  ```bash
  adb shell dumpsys package com.habittile.app | grep -E "POST_NOTIFICATIONS|RECEIVE_BOOT_COMPLETED"
  adb shell dumpsys alarm | grep -B2 -A6 com.habittile.app     # RTC_WAKEUP for ReminderAlarmReceiver
  adb shell pm revoke com.habittile.app android.permission.POST_NOTIFICATIONS   # flip the card
  adb shell dumpsys notification --noredact | grep -A20 com.habittile.app
  adb shell dumpsys battery unplug && adb shell dumpsys deviceidle force-idle   # still fires (≤ ~9 min throttle)
  adb reboot                                                   # then dumpsys alarm shows it re-armed
  ```
  - Fire test: log, advance the device date one day (live streak, unlogged), set the reminder to now + 2 min, lock the screen → "Streak at risk · N day streak · Xh left".
  - Silent paths: log via the tile first → nothing; rest day → nothing; fresh install (streak 0) → nothing.
  - "Log now" → notification gone, tile reads "· done" on next shade open, app shows logged, `dumpsys alarm` shows tomorrow.
  - `am broadcast -n …/ReminderAlarmReceiver` is refused for non-exported receivers on 33+; use the 2-minute test.

---

## Remaining projects  *(awaiting the user's list)*

<!-- One section per project, same shape as above:
### N. <Name>  (<platform>)
- What it is
- Platform surfaces / APIs
- Design decisions (from the chat)
- Build order / dependencies
-->

_To be filled in from the pasted project list._
