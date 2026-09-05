import { useCallback, useEffect, useState } from "react";
import {
  AppState,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";

import * as HabitTile from "./modules/expo-habit-tile";
import type {
  HabitState,
  PermissionResponse,
  ReminderState,
} from "./modules/expo-habit-tile";

const DKMA_API = "https://dontkillmyapp.com/api/v2";
const REMINDER_PRESETS = [18, 19, 20, 21, 22];
const pad2 = (n: number) => String(n).padStart(2, "0");
const fmtTime = (h: number, m: number) => `${pad2(h)}:${pad2(m)}`;

export default function App() {
  const [state, setState] = useState<HabitState>(HabitTile.getState());
  const [batteryExempt, setBatteryExempt] = useState<boolean>(true);
  const [killGapMin, setKillGapMin] = useState<number>(0);
  const [vendor, setVendor] = useState<string>("");
  const [vendorTip, setVendorTip] = useState<string | null>(null);
  const [reminder, setReminder] = useState<ReminderState>(HabitTile.getReminder());
  const [notifPerm, setNotifPerm] = useState<PermissionResponse>({
    status: "undetermined",
    granted: false,
    canAskAgain: true,
  });

  const refresh = useCallback(() => {
    setState(HabitTile.getState());
    setBatteryExempt(HabitTile.isIgnoringBatteryOptimizations());
    setKillGapMin(Math.round(HabitTile.getHeartbeatGapMs() / 60000));
    // Re-arms the alarm from stored settings and reports the next trigger.
    setReminder(HabitTile.reconcileReminder());
    HabitTile.getNotificationPermission().then(setNotifPerm);
  }, []);

  // Heartbeat + reconcile on every foreground. If the gap is large, the process
  // was killed while we were away — the moment to re-prompt for the OEM fix.
  useEffect(() => {
    HabitTile.heartbeat();
    refresh();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") {
        refresh();
        HabitTile.heartbeat();
      }
    });
    return () => sub.remove();
  }, [refresh]);

  // Pull the vendor-specific autostart guidance (maintainable > hardcoding).
  useEffect(() => {
    const m = HabitTile.getManufacturer();
    setVendor(m);
    if (!m) return;
    fetch(`${DKMA_API}/${m.toLowerCase()}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const tip = j?.user_solution?.[0] ?? j?.name;
        if (tip) setVendorTip(typeof tip === "string" ? tip : String(tip));
      })
      .catch(() => setVendorTip(null));
  }, []);

  const onLog = () => {
    setState(HabitTile.logHabit());
    setReminder(HabitTile.getReminder());
  };
  const onToggleRest = (rest: boolean) => {
    setState(HabitTile.setRestDay(rest));
    setReminder(HabitTile.getReminder());
  };

  // ---- Streak reminder ----
  const onAllowNotifications = async () => {
    const res = await HabitTile.requestNotificationPermission();
    setNotifPerm(res);
    // Granting is the intent to be reminded: switch it on with stored defaults.
    if (res.granted && !reminder.enabled) {
      setReminder(HabitTile.setReminder({ ...reminder, enabled: true }));
    } else {
      setReminder(HabitTile.getReminder());
    }
  };
  const onToggleReminder = (enabled: boolean) =>
    setReminder(HabitTile.setReminder({ ...reminder, enabled }));
  const onPickTime = (hour: number, minute: number) =>
    setReminder(HabitTile.setReminder({ ...reminder, hour, minute }));
  const onStepTime = (deltaMin: number) => {
    const total = (reminder.hour * 60 + reminder.minute + deltaMin + 1440) % 1440;
    onPickTime(Math.floor(total / 60), total % 60);
  };

  const reminderReady = notifPerm.granted && reminder.notificationsAllowed;
  const nextCheck =
    reminder.enabled && reminder.nextTriggerAt > 0
      ? new Date(reminder.nextTriggerAt)
      : null;

  const available = HabitTile.isTileAvailable();

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.kicker}>DAILY HABIT</Text>

        {/* Streak hero */}
        <View style={styles.hero}>
          <Text style={styles.streakNum}>{state.streak}</Text>
          <Text style={styles.streakLabel}>
            day{state.streak === 1 ? "" : "s"} streak
          </Text>
          <Text style={styles.subtitle}>{state.subtitle}</Text>
        </View>

        {/* One-tap log */}
        <Pressable
          style={({ pressed }) => [
            styles.logBtn,
            state.loggedToday && styles.logBtnDone,
            pressed && { opacity: 0.85 },
          ]}
          onPress={onLog}
          disabled={state.restDay}
        >
          <Text style={styles.logBtnText}>
            {state.loggedToday ? "Logged today ✓" : "Log now"}
          </Text>
        </Pressable>

        {/* Rest day */}
        <View style={styles.rowCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Rest day</Text>
            <Text style={styles.rowSub}>Greys the tile out — nothing to do today</Text>
          </View>
          <Switch value={state.restDay} onValueChange={onToggleRest} />
        </View>

        {/* Streak-at-risk reminder */}
        <View style={styles.infoCard}>
          <View style={styles.cardHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>
                Streak reminder {reminderReady ? "— allowed ✓" : "— off"}
              </Text>
              <Text style={styles.rowSub}>
                Only fires when a streak is live and today is unlogged.
              </Text>
            </View>
            <Switch
              value={reminder.enabled}
              onValueChange={onToggleReminder}
              disabled={!reminderReady}
            />
          </View>

          {!reminderReady && (
            <>
              <Text style={styles.cardBody}>
                {notifPerm.granted
                  ? "Notifications are blocked for this app or channel. Re-enable them in app settings."
                  : "Allow notifications to get a nudge in the evening when a live streak is still unlogged."}
              </Text>
              <Pressable
                style={styles.secondaryBtn}
                onPress={
                  !notifPerm.granted && notifPerm.canAskAgain
                    ? onAllowNotifications
                    : HabitTile.openAppSettings
                }
              >
                <Text style={styles.secondaryBtnText}>
                  {!notifPerm.granted && notifPerm.canAskAgain
                    ? "Allow notifications"
                    : "Open app settings"}
                </Text>
              </Pressable>
            </>
          )}

          {reminderReady && (
            <>
              <View style={styles.chipRow}>
                {REMINDER_PRESETS.map((h) => {
                  const selected = reminder.hour === h && reminder.minute === 0;
                  return (
                    <Pressable
                      key={h}
                      style={[styles.chip, selected && styles.chipSelected]}
                      onPress={() => onPickTime(h, 0)}
                      disabled={!reminder.enabled}
                    >
                      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                        {fmtTime(h, 0)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <View style={styles.stepperRow}>
                <Pressable
                  style={styles.stepBtn}
                  onPress={() => onStepTime(-15)}
                  disabled={!reminder.enabled}
                >
                  <Text style={styles.stepBtnText}>−15m</Text>
                </Pressable>
                <Text style={styles.timeLabel}>
                  {fmtTime(reminder.hour, reminder.minute)}
                </Text>
                <Pressable
                  style={styles.stepBtn}
                  onPress={() => onStepTime(15)}
                  disabled={!reminder.enabled}
                >
                  <Text style={styles.stepBtnText}>+15m</Text>
                </Pressable>
              </View>
              <Text style={styles.cardBody}>
                {reminder.enabled && nextCheck
                  ? `Next check: ${fmtTime(nextCheck.getHours(), nextCheck.getMinutes())}${
                      nextCheck.getDate() !== new Date().getDate() ? " tomorrow" : ""
                    }. Inexact by design — it may arrive a few minutes late.`
                  : "Off. Turn it on to be nudged before midnight if a live streak is still unlogged."}
              </Text>
            </>
          )}
        </View>

        {/* Tile availability + how to add */}
        <View style={styles.infoCard}>
          <Text style={styles.cardTitle}>Quick Settings tile</Text>
          <Text style={styles.cardBody}>
            {available
              ? "Native tile is linked. Tap below to add it (or add it manually from the shade’s edit-tiles tray). Tapping the tile logs in one tap and shows a subtitle that changes with the time of day."
              : "Native module not loaded yet — rebuild the Android app (expo run:android)."}
          </Text>
          {available && (
            <Pressable style={styles.secondaryBtn} onPress={HabitTile.requestAddTile}>
              <Text style={styles.secondaryBtnText}>Add the tile</Text>
            </Pressable>
          )}
        </View>

        {/* AOSP battery layer */}
        <View style={styles.infoCard}>
          <Text style={styles.cardTitle}>
            Battery optimization {batteryExempt ? "— exempt ✓" : "— on"}
          </Text>
          <Text style={styles.cardBody}>
            This only covers the AOSP layer. Exempting the app stops Doze from
            deferring it.
          </Text>
          <Pressable
            style={styles.secondaryBtn}
            onPress={HabitTile.openBatteryOptimizationSettings}
          >
            <Text style={styles.secondaryBtnText}>Open battery settings</Text>
          </Pressable>
        </View>

        {/* OEM layer */}
        <View style={styles.infoCard}>
          <Text style={styles.cardTitle}>
            Autostart {vendor ? `(${vendor})` : ""}
          </Text>
          <Text style={styles.cardBody}>
            {vendorTip
              ? vendorTip
              : "The real killer is the OEM skin, not AOSP. On aggressive vendors (Xiaomi, Oppo, Vivo, Transsion/Tecno/Infinix) enable autostart or the tile can be prevented from running."}
          </Text>
          <Pressable style={styles.secondaryBtn} onPress={HabitTile.openAppSettings}>
            <Text style={styles.secondaryBtnText}>Open app settings</Text>
          </Pressable>
        </View>

        {/* Kill detection */}
        <Text style={styles.footnote}>
          {killGapMin > 0
            ? `Last seen alive ${killGapMin} min ago.`
            : "Heartbeat running."}
          {Platform.OS !== "android" ? "  (Android-only project)" : ""}
        </Text>
      </ScrollView>
    </View>
  );
}

const INK = "#111827";
const ACCENT = "#4F46E5";
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#F4F4F7" },
  content: { padding: 20, paddingTop: 72, paddingBottom: 48, gap: 14 },
  kicker: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.5,
    color: "#9AA0AE",
  },
  hero: {
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    paddingVertical: 32,
    alignItems: "center",
  },
  streakNum: { fontSize: 72, fontWeight: "800", color: INK, lineHeight: 78 },
  streakLabel: { fontSize: 16, fontWeight: "600", color: "#6B7280", marginTop: 2 },
  subtitle: { fontSize: 15, color: ACCENT, fontWeight: "600", marginTop: 14 },
  logBtn: {
    backgroundColor: ACCENT,
    borderRadius: 18,
    paddingVertical: 18,
    alignItems: "center",
  },
  logBtnDone: { backgroundColor: "#22C55E" },
  logBtnText: { color: "#FFFFFF", fontSize: 17, fontWeight: "700" },
  rowCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 16,
  },
  rowTitle: { fontSize: 16, fontWeight: "600", color: INK },
  rowSub: { fontSize: 13, color: "#8A90A0", marginTop: 2 },
  infoCard: { backgroundColor: "#FFFFFF", borderRadius: 18, padding: 16, gap: 10 },
  cardTitle: { fontSize: 16, fontWeight: "700", color: INK },
  cardBody: { fontSize: 14, lineHeight: 20, color: "#4B5563" },
  secondaryBtn: {
    alignSelf: "flex-start",
    backgroundColor: "#EEF0FF",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  secondaryBtnText: { color: ACCENT, fontWeight: "700", fontSize: 14 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    backgroundColor: "#EEF0FF",
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  chipSelected: { backgroundColor: ACCENT },
  chipText: { color: ACCENT, fontWeight: "700", fontSize: 13 },
  chipTextSelected: { color: "#FFFFFF" },
  stepperRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  stepBtn: {
    backgroundColor: "#F4F4F7",
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  stepBtnText: { color: INK, fontWeight: "700", fontSize: 13 },
  timeLabel: {
    fontSize: 22,
    fontWeight: "800",
    color: INK,
    fontVariant: ["tabular-nums"],
    minWidth: 72,
    textAlign: "center",
  },
  footnote: { fontSize: 12, color: "#9AA0AE", textAlign: "center", marginTop: 8 },
});
