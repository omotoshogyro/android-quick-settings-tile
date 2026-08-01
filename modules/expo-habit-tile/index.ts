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

type NativeShape = {
  getState(): HabitState;
  logHabit(): HabitState;
  setRestDay(rest: boolean): HabitState;
  heartbeat(): void;
  getHeartbeatGapMs(): number;
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

export const isTileAvailable = (): boolean => Native != null;

export const getState = (): HabitState => Native?.getState() ?? EMPTY;
export const logHabit = (): HabitState => Native?.logHabit() ?? EMPTY;
export const setRestDay = (rest: boolean): HabitState =>
  Native?.setRestDay(rest) ?? EMPTY;

export const heartbeat = (): void => Native?.heartbeat();
export const getHeartbeatGapMs = (): number => Native?.getHeartbeatGapMs() ?? 0;

export const isIgnoringBatteryOptimizations = (): boolean =>
  Native?.isIgnoringBatteryOptimizations() ?? true;
export const openBatteryOptimizationSettings = (): void =>
  Native?.openBatteryOptimizationSettings();
export const openAppSettings = (): void => Native?.openAppSettings();
export const getManufacturer = (): string => Native?.getManufacturer() ?? "";
export const requestAddTile = (): void => Native?.requestAddTile();
