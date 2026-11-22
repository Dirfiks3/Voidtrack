import { create } from "zustand";
import type {
  Habit,
  HabitReminder,
  HabitReminderInput,
  NotificationStatus,
  ReminderSettings,
} from "../../lib/types";
import { reminderApi } from "./api";
import { DEFAULT_REMINDER_SETTINGS, defaultReminder } from "./defaults";

const isAndroid =
  typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);

interface ReminderState {
  settings: ReminderSettings;
  reminders: Record<string, HabitReminder>;
  status: NotificationStatus | null;
  loading: boolean;
  load: () => Promise<void>;
  refresh: () => Promise<void>;
  saveSettings: (patch: Partial<ReminderSettings>) => Promise<void>;
  saveReminder: (habitId: string, input: HabitReminderInput) => Promise<void>;
  requestPermission: () => Promise<void>;
  test: (habitId: string) => Promise<void>;
  forHabit: (habit: Habit | undefined) => HabitReminder | null;
}

export const useReminders = create<ReminderState>((set, get) => ({
  settings: { ...DEFAULT_REMINDER_SETTINGS },
  reminders: {},
  status: null,
  loading: true,

  load: async () => {
    try {
      const [settings, list, status] = await Promise.all([
        reminderApi.settings(),
        reminderApi.list(),
        reminderApi.status(),
      ]);
      const reminders: Record<string, HabitReminder> = {};
      for (const reminder of list) reminders[reminder.habit_id] = reminder;
      set({
        settings,
        reminders,
        status,
        loading: false,
      });
      // Android 13+ не показывает уведомления без POST_NOTIFICATIONS.
      // Запрашиваем один раз, пока пользователь ещё не ответил на запрос.
      if ((isAndroid || status?.platform === "android") && status?.permission === "prompt") {
        void get().requestPermission();
      }
    } catch {
      set({ loading: false });
    }
  },

  refresh: async () => {
    await get().load();
  },

  saveSettings: async (patch) => {
    const previous = get().settings;
    const next = { ...previous, ...patch };
    set({ settings: next });
    try {
      const saved = await reminderApi.saveSettings(next);
      const status = await reminderApi.status();
      set({ settings: saved, status });
    } catch {
      set({ settings: previous });
      throw new Error("Не удалось сохранить настройки уведомлений");
    }
  },

  saveReminder: async (habitId, input) => {
    try {
      const saved = await reminderApi.save(habitId, input);
      set((state) => ({
        reminders: { ...state.reminders, [habitId]: saved },
      }));
      const status = await reminderApi.status().catch(() => null);
      if (status) set({ status });
    } catch (error) {
      throw error instanceof Error ? error : new Error("Не удалось сохранить напоминание");
    }
  },

  requestPermission: async () => {
    const permission = await reminderApi.requestPermission();
    set((state) => ({
      status: state.status ? { ...state.status, permission } : state.status,
    }));
    // Стартовое расписание уже отработало с запретом; после разрешения
    // пересоздаём его через обычный путь изменения настроек.
    if (permission === "granted" && (isAndroid || get().status?.platform === "android")) {
      await reminderApi.saveSettings(get().settings).catch(() => undefined);
    }
  },

  test: async (habitId) => {
    await reminderApi.test(habitId);
  },

  forHabit: (habit) => {
    if (!habit) return null;
    const { reminders, settings } = get();
    return reminders[habit.id] ?? defaultReminder(habit, settings);
  },
}));
