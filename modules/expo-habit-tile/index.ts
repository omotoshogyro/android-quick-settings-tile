import { requireOptionalNativeModule } from "expo";

export type HabitState = {
  /** Streak DERIVED on read (0 if it has lapsed) — never a timer-maintained value. */
  streak: number;
  loggedToday: boolean;
  restDay: boolean;
  /** epoch ms of the most recent log, 0 if never. */
  lastLoggedAt: number;
  /** The contextual line the tile shows, recomputed each read. */
  subtitle: string;
  hoursLeftToday: number;
};

export type ReminderState = {
  enabled: boolean;
  /** Local time of day, 0–23 / 0–59. */
  hour: number;
  minute: number;
  /** epoch ms of the next armed alarm, 0 when disabled. */
  nextTriggerAt: number;
  /** App-level notifications on AND the channel not blocked (26+). */
  notificationsAllowed: boolean;
};

export type PermissionStatus = "granted" | "denied" | "undetermined";

export type PermissionResponse = {
  status: PermissionStatus;
  granted: boolean;
  canAskAgain: boolean;
};

type NativeShape = {
  getState(): HabitState;
  logHabit(): HabitState;
  setRestDay(rest: boolean): HabitState;
  heartbeat(): void;
  getHeartbeatGapMs(): number;
  getReminder(): ReminderState;
  setReminder(enabled: boolean, hour: number, minute: number): ReminderState;
  reconcileReminder(): ReminderState;
  requestNotificationPermission(): Promise<Partial<PermissionResponse>>;
  getNotificationPermission(): Promise<Partial<PermissionResponse>>;
  isIgnoringBatteryOptimizations(): boolean;
  openBatteryOptimizationSettings(): void;
  openAppSettings(): void;
  getManufacturer(): string;
  requestAddTile(): void;
};

// Optional loader: the JS bundle still runs on a build that predates the native
// module (e.g. before an Android rebuild), degrading to the fallbacks below.
const Native = requireOptionalNativeModule<NativeShape>("ExpoHabitTile");

const EMPTY: HabitState = {
  streak: 0,
  loggedToday: false,
  restDay: false,
  lastLoggedAt: 0,
  subtitle: "Start your streak",
  hoursLeftToday: 0,
};

const EMPTY_REMINDER: ReminderState = {
  enabled: false,
  hour: 20,
  minute: 0,
  nextTriggerAt: 0,
  notificationsAllowed: false,
};

const DENIED: PermissionResponse = {
  status: "denied",
  granted: false,
  canAskAgain: false,
};

export const isTileAvailable = (): boolean => Native != null;

export const getState = (): HabitState => Native?.getState() ?? EMPTY;
export const logHabit = (): HabitState => Native?.logHabit() ?? EMPTY;
export const setRestDay = (rest: boolean): HabitState =>
  Native?.setRestDay(rest) ?? EMPTY;

export const heartbeat = (): void => Native?.heartbeat();
export const getHeartbeatGapMs = (): number => Native?.getHeartbeatGapMs() ?? 0;

// ---- Streak-at-risk reminder ----
export const getReminder = (): ReminderState =>
  Native?.getReminder() ?? EMPTY_REMINDER;

export const setReminder = (r: {
  enabled: boolean;
  hour: number;
  minute: number;
}): ReminderState =>
  Native?.setReminder(r.enabled, r.hour, r.minute) ?? EMPTY_REMINDER;

/** Re-arm the alarm from the current settings (call on foreground). */
export const reconcileReminder = (): ReminderState =>
  Native?.reconcileReminder() ?? EMPTY_REMINDER;

const normalize = (r: Partial<PermissionResponse> | null | undefined): PermissionResponse => ({
  status: r?.status ?? "denied",
  granted: r?.granted ?? false,
  canAskAgain: r?.canAskAgain ?? false,
});

// Both resolve to DENIED when the module is missing or the permissions
// manager isn't registered (native rejects with E_NO_PERMISSIONS).
export const requestNotificationPermission = async (): Promise<PermissionResponse> => {
  if (!Native) return DENIED;
  try {
    return normalize(await Native.requestNotificationPermission());
  } catch {
    return DENIED;
  }
};

export const getNotificationPermission = async (): Promise<PermissionResponse> => {
  if (!Native) return DENIED;
  try {
    return normalize(await Native.getNotificationPermission());
  } catch {
    return DENIED;
  }
};

export const isIgnoringBatteryOptimizations = (): boolean =>
  Native?.isIgnoringBatteryOptimizations() ?? true;
export const openBatteryOptimizationSettings = (): void =>
  Native?.openBatteryOptimizationSettings();
export const openAppSettings = (): void => Native?.openAppSettings();
export const getManufacturer = (): string => Native?.getManufacturer() ?? "";
export const requestAddTile = (): void => Native?.requestAddTile();
