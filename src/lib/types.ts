export type ScheduleType = "daily" | "weekdays" | "weekends" | "custom";

export interface Habit {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  category: string;
  created_at: string;
  archived: boolean;
  target_per_week: number;
  schedule_type: ScheduleType;
  /** 1 = Пн … 7 = Вс */
  weekdays: number[];
  /** Порядок в списке; меньше = выше. */
  sort_order: number;
}

export type NewHabit = Omit<
  Habit,
  "id" | "created_at" | "archived" | "sort_order"
>;

export interface Checkin {
  id: string;
  habit_id: string;
  date: string;
  created_at: string;
  note: string;
}

export interface ImportSummary {
  habits: number;
  checkins: number;
  skipped: number;
}

export interface LogEntry {
  time: string;
  level: string;
  source: string;
  message: string;
}

export type SortMode = "manual" | "name" | "target" | "streak";

export interface Suggestion {
  name: string;
  description: string;
  icon: string;
  color: string;
  category: string;
  score: number;
}

export interface NowInfo {
  date: string;
  time: string;
  weekday_ru: string;
  weekday_short: string;
  month_ru: string;
  label: string;
  iso_weekday: number;
}

export type AccentId = "ice" | "emerald" | "chrome" | "amber" | "violet" | "custom";
/** Единственный объёмный объект приложения — неделя на направляющей. */
export type ShapeId = "week" | "off";
export type Density = "compact" | "cards";

export interface Settings {
  accent: AccentId;
  accentHex: string;
  shape: ShapeId;
  /** 10–40 px */
  blur: number;
  /** 0–100 */
  opacity: number;
  /** 0–100 */
  highlight: number;
  density: Density;
}

export interface AppData {
  habits: Habit[];
  checkins: Checkin[];
}

export type ViewId = "today" | "calendar" | "stats" | "library";

// --- Уведомления ---------------------------------------------------------

export type ReminderMode = "interval" | "times";

export interface ReminderSettings {
  enabled: boolean;
  quiet_hours_enabled: boolean;
  quiet_start: string;
  quiet_end: string;
  /** 1 = Пн … 7 = Вс */
  active_days: number[];
  default_interval_minutes: number;
  sound_enabled: boolean;
  vibration_enabled: boolean;
}

export interface HabitReminder {
  habit_id: string;
  enabled: boolean;
  mode: ReminderMode;
  interval_minutes: number;
  times: string[];
  /** 1 = Пн … 7 = Вс */
  days: number[];
  title: string;
  body: string;
  skip_if_done: boolean;
  last_fired_slot: string | null;
}

export type HabitReminderInput = Omit<HabitReminder, "habit_id" | "last_fired_slot">;

export type PermissionState = "granted" | "denied" | "prompt";

export interface NotificationStatus {
  permission: PermissionState;
  platform: "android" | "desktop";
  settings: ReminderSettings;
  active_habits: number;
  scheduled_count: number;
}
