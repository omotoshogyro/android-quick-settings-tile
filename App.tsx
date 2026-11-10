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
        const raw = j?.user_solution?.[0] ?? j?.name;
        // Strip markup; ignore anything too short to be a real instruction.
        const tip = typeof raw === "string" ? raw.replace(/<[^>]*>/g, "").trim() : "";
        setVendorTip(tip.length >= 12 ? tip : null);
      })
      .catch(() => setVendorTip(null));
  }, []);

  const onLog = () => {
    setState(HabitTile.logHabit());
    setReminder(HabitTile.getReminder());
  };
  const onUndo = () => {
    setState(HabitTile.unlogToday());
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

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.date}>{today}</Text>
          <Text style={styles.title}>Today</Text>
        </View>

        {/* Hero: one big tap target, streak underneath */}
        <View style={styles.hero}>
          <Pressable
            style={({ pressed }) => [
              styles.orb,
              state.loggedToday && styles.orbDone,
              pressed && !state.loggedToday && { transform: [{ scale: 0.97 }] },
            ]}
            onPress={onLog}
            disabled={state.loggedToday}
            accessibilityRole="button"
            accessibilityLabel={state.loggedToday ? "Habit logged today" : "Log habit now"}
            accessibilityState={{ disabled: state.loggedToday }}
          >
            <Text style={[styles.orbText, state.loggedToday && styles.orbTextDone]}>
              {state.loggedToday ? "✓" : "Log"}
            </Text>
          </Pressable>
          <Text style={styles.streakNum}>{state.streak}</Text>
          <Text style={styles.streakLabel}>
            day{state.streak === 1 ? "" : "s"} streak
          </Text>
          {!state.loggedToday && <Text style={styles.subtitle}>{state.subtitle}</Text>}
          {state.loggedToday && (
            <Pressable
              onPress={onUndo}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Undo today's log"
            >
              <Text style={styles.link}>Undo today's log</Text>
            </Pressable>
          )}
        </View>

        <Text style={styles.sectionLabel}>HABIT</Text>
        <View style={styles.group}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Rest day</Text>
              <Text style={styles.rowSub}>Keeps your streak; you can still log</Text>
            </View>
            <Switch
              value={state.restDay}
              onValueChange={onToggleRest}
              trackColor={{ false: "#E4E4E0", true: ACCENT }}
              thumbColor="#FFFFFF"
            />
          </View>
        </View>

        <Text style={styles.sectionLabel}>REMINDER</Text>
        <View style={styles.group}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Streak reminder</Text>
              <Text style={styles.rowSub}>
                Evening nudge when a live streak is unlogged
              </Text>
            </View>
            <Switch
              value={reminder.enabled}
              onValueChange={onToggleReminder}
              disabled={!reminderReady}
              trackColor={{ false: "#E4E4E0", true: ACCENT }}
              thumbColor="#FFFFFF"
            />
          </View>

          {!reminderReady && (
            <>
              <View style={styles.divider} />
              <View style={styles.rowBlock}>
                <Text style={styles.body}>
                  {notifPerm.granted
                    ? "Notifications are blocked for this app or channel. Re-enable them in app settings."
                    : "Allow notifications to get a nudge in the evening when a live streak is still unlogged."}
                </Text>
                <Pressable
                  style={styles.pill}
                  onPress={
                    !notifPerm.granted && notifPerm.canAskAgain
                      ? onAllowNotifications
                      : HabitTile.openAppSettings
                  }
                  accessibilityRole="button"
                  accessibilityLabel={
                    !notifPerm.granted && notifPerm.canAskAgain
                      ? "Allow notifications"
                      : "Open app settings"
                  }
                >
                  <Text style={styles.pillText}>
                    {!notifPerm.granted && notifPerm.canAskAgain
                      ? "Allow notifications"
                      : "Open app settings"}
                  </Text>
                </Pressable>
              </View>
            </>
          )}

          {reminderReady && (
            <>
              <View style={styles.divider} />
              <View style={styles.rowBlock}>
                <View style={styles.stepperRow}>
                  <Pressable
                    style={styles.stepBtn}
                    onPress={() => onStepTime(-15)}
                    disabled={!reminder.enabled}
                    accessibilityRole="button"
                    accessibilityLabel="Remind 15 minutes earlier"
                    accessibilityState={{ disabled: !reminder.enabled }}
                  >
                    <Text style={styles.stepBtnText}>−</Text>
                  </Pressable>
                  <Text style={[styles.timeLabel, !reminder.enabled && { opacity: 0.35 }]}>
                    {fmtTime(reminder.hour, reminder.minute)}
                  </Text>
                  <Pressable
                    style={styles.stepBtn}
                    onPress={() => onStepTime(15)}
                    disabled={!reminder.enabled}
                    accessibilityRole="button"
                    accessibilityLabel="Remind 15 minutes later"
                    accessibilityState={{ disabled: !reminder.enabled }}
                  >
                    <Text style={styles.stepBtnText}>+</Text>
                  </Pressable>
                </View>
                <View style={styles.chipRow}>
                  {REMINDER_PRESETS.map((h) => {
                    const selected = reminder.hour === h && reminder.minute === 0;
                    return (
                      <Pressable
                        key={h}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => onPickTime(h, 0)}
                        disabled={!reminder.enabled}
                        accessibilityRole="button"
                        accessibilityLabel={`Remind at ${fmtTime(h, 0)}`}
                        accessibilityState={{ selected, disabled: !reminder.enabled }}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                          {fmtTime(h, 0)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={styles.caption}>
                  {reminder.enabled && nextCheck
                    ? `Next check ${fmtTime(nextCheck.getHours(), nextCheck.getMinutes())}${
                        nextCheck.getDate() !== new Date().getDate() ? " tomorrow" : ""
                      }. May arrive a few minutes late.`
                    : "Off. Turn it on to be nudged before midnight."}
                </Text>
              </View>
            </>
          )}
        </View>

        <Text style={styles.sectionLabel}>SETUP</Text>
        <View style={styles.group}>
          <View style={styles.rowBlock}>
            <Text style={styles.rowTitle}>Quick Settings tile</Text>
            <Text style={styles.body}>
              {available
                ? "Log in one tap from the notification shade. Add it here or from the shade's edit-tiles tray."
                : "Native module not loaded yet. Rebuild the Android app (expo run:android)."}
            </Text>
            {available && (
              <Pressable
                style={styles.pill}
                onPress={HabitTile.requestAddTile}
                accessibilityRole="button"
                accessibilityLabel="Add the Quick Settings tile"
              >
                <Text style={styles.pillText}>Add the tile</Text>
              </Pressable>
            )}
          </View>
          <View style={styles.divider} />
          <View style={styles.rowBlock}>
            <Text style={styles.rowTitle}>
              Battery optimization {batteryExempt ? "· exempt" : "· on"}
            </Text>
            <Text style={styles.body}>
              Exempting the app stops Doze from deferring the reminder.
            </Text>
            <Pressable
              style={styles.pill}
              onPress={HabitTile.openBatteryOptimizationSettings}
              accessibilityRole="button"
              accessibilityLabel="Open battery settings"
            >
              <Text style={styles.pillText}>Open battery settings</Text>
            </Pressable>
          </View>
          <View style={styles.divider} />
          <View style={styles.rowBlock}>
            <Text style={styles.rowTitle}>Autostart{vendor ? ` · ${vendor}` : ""}</Text>
            <Text style={styles.body}>
              {vendorTip
                ? vendorTip
                : "Some vendors (Xiaomi, Oppo, Vivo, Transsion) block background apps unless autostart is enabled."}
            </Text>
            <Pressable
              style={styles.pill}
              onPress={HabitTile.openAppSettings}
              accessibilityRole="button"
              accessibilityLabel="Open app settings"
            >
              <Text style={styles.pillText}>Open app settings</Text>
            </Pressable>
          </View>
        </View>

        <Text style={styles.footnote}>
          {killGapMin > 0
            ? `Last seen alive ${killGapMin} min ago`
            : "Heartbeat running"}
          {Platform.OS !== "android" ? "  (Android-only project)" : ""}
        </Text>
      </ScrollView>
    </View>
  );
}

const INK = "#0F1115";
const ACCENT = "#4F46E5";
const MUTED = "#8B8F98";
const LINE = "#EEEEEA";
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#FAFAF7" },
  content: { paddingHorizontal: 20, paddingTop: 64, paddingBottom: 56 },
  header: { marginBottom: 8 },
  date: { fontSize: 14, color: MUTED, fontWeight: "500" },
  title: { fontSize: 34, fontWeight: "800", color: INK, letterSpacing: -0.8, marginTop: 2 },

  hero: { alignItems: "center", paddingVertical: 28 },
  orb: {
    width: 176,
    height: 176,
    borderRadius: 88,
    backgroundColor: "#FFFFFF",
    borderWidth: 3,
    borderColor: ACCENT,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: ACCENT,
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  orbDone: { backgroundColor: ACCENT, borderColor: ACCENT },
  orbText: { fontSize: 40, fontWeight: "800", color: ACCENT, letterSpacing: -0.5 },
  orbTextDone: { color: "#FFFFFF", fontSize: 64 },
  streakNum: {
    fontSize: 64,
    fontWeight: "800",
    color: INK,
    letterSpacing: -2,
    marginTop: 28,
    lineHeight: 68,
  },
  streakLabel: { fontSize: 15, fontWeight: "600", color: MUTED, marginTop: 2 },
  subtitle: { fontSize: 14, color: ACCENT, fontWeight: "600", marginTop: 12 },
  link: { fontSize: 13, color: MUTED, fontWeight: "600", marginTop: 14, textDecorationLine: "underline" },

  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: MUTED,
    marginTop: 20,
    marginBottom: 8,
    marginLeft: 6,
  },
  group: { backgroundColor: "#FFFFFF", borderRadius: 20, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", padding: 16, gap: 12 },
  rowText: { flex: 1 },
  rowBlock: { padding: 16, gap: 10 },
  rowTitle: { fontSize: 16, fontWeight: "600", color: INK },
  rowSub: { fontSize: 13, color: MUTED, marginTop: 2 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: LINE, marginLeft: 16 },
  body: { fontSize: 14, lineHeight: 20, color: "#5B6068" },
  caption: { fontSize: 12, color: MUTED },
  pill: {
    alignSelf: "flex-start",
    backgroundColor: "#F1F0FF",
    borderRadius: 999,
    paddingVertical: 9,
    paddingHorizontal: 16,
  },
  pillText: { color: ACCENT, fontWeight: "700", fontSize: 13 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    backgroundColor: "#F4F4F1",
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  chipSelected: { backgroundColor: INK },
  chipText: { color: "#4B5058", fontWeight: "600", fontSize: 13 },
  chipTextSelected: { color: "#FFFFFF" },
  stepperRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 24 },
  stepBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#F4F4F1",
    alignItems: "center",
    justifyContent: "center",
  },
  stepBtnText: { color: INK, fontWeight: "600", fontSize: 22, lineHeight: 26 },
  timeLabel: {
    fontSize: 36,
    fontWeight: "800",
    color: INK,
    letterSpacing: -1,
    fontVariant: ["tabular-nums"],
    minWidth: 110,
    textAlign: "center",
  },
  footnote: { fontSize: 12, color: MUTED, textAlign: "center", marginTop: 24 },
});
