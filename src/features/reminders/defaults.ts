import type { Habit, HabitReminder, HabitReminderInput, ReminderSettings } from "../../lib/types";

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  enabled: true,
  quiet_hours_enabled: false,
  quiet_start: "23:00",
  quiet_end: "08:00",
  active_days: [1, 2, 3, 4, 5, 6, 7],
  default_interval_minutes: 210,
  sound_enabled: true,
  vibration_enabled: true,
};

export const INTERVAL_PRESETS = [120, 180, 210, 240];
export const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

export const clampInterval = (minutes: number): number =>
  Math.min(1440, Math.max(30, Math.round(minutes) || 210));

export const normalizeTime = (value: string, fallback = "09:00"): string => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return fallback;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};

export const normalizeDays = (days: number[]): number[] => {
  const result = Array.from(new Set(days.filter((day) => day >= 1 && day <= 7))).sort(
    (a, b) => a - b,
  );
  return result.length ? result : [...ALL_DAYS];
};

export const reminderTitle = (name: string): string => `${name} — пора`;
export const reminderBody = (name: string): string =>
  `Напоминание: ${name}. Отметьте привычку, когда выполните.`;

export function defaultReminder(habit: Habit, settings: ReminderSettings): HabitReminder {
  return {
    habit_id: habit.id,
    enabled: true,
    mode: "interval",
    interval_minutes: settings.default_interval_minutes,
    times: ["09:00"],
    days: normalizeDays(habit.weekdays ?? settings.active_days),
    title: reminderTitle(habit.name),
    body: reminderBody(habit.name),
    skip_if_done: true,
    last_fired_slot: null,
  };
}

export function toInput(reminder: HabitReminder): HabitReminderInput {
  return {
    enabled: reminder.enabled,
    mode: reminder.mode,
    interval_minutes: clampInterval(reminder.interval_minutes),
    times: reminder.times.length ? reminder.times : ["09:00"],
    days: normalizeDays(reminder.days),
    title: reminder.title,
    body: reminder.body,
    skip_if_done: reminder.skip_if_done,
  };
}

export function formatInterval(minutes: number): string {
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
}
