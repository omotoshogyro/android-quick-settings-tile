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
import type { HabitState } from "./modules/expo-habit-tile";

const DKMA_API = "https://dontkillmyapp.com/api/v2";

export default function App() {
  const [state, setState] = useState<HabitState>(HabitTile.getState());
  const [batteryExempt, setBatteryExempt] = useState<boolean>(true);
  const [killGapMin, setKillGapMin] = useState<number>(0);
  const [vendor, setVendor] = useState<string>("");
  const [vendorTip, setVendorTip] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setState(HabitTile.getState());
    setBatteryExempt(HabitTile.isIgnoringBatteryOptimizations());
    setKillGapMin(Math.round(HabitTile.getHeartbeatGapMs() / 60000));
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

  const onLog = () => setState(HabitTile.logHabit());
  const onToggleRest = (rest: boolean) => setState(HabitTile.setRestDay(rest));

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
  footnote: { fontSize: 12, color: "#9AA0AE", textAlign: "center", marginTop: 8 },
});
