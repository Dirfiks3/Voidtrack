import { invoke, isTauri } from "../../lib/api";
import type {
  HabitReminder,
  HabitReminderInput,
  NotificationStatus,
  PermissionState,
  ReminderSettings,
} from "../../lib/types";

export const reminderApi = {
  settings: () => invoke<ReminderSettings>("reminder_settings"),

  saveSettings: (settings: ReminderSettings) =>
    invoke<ReminderSettings>("save_reminder_settings", { settings }),

  list: () => invoke<HabitReminder[]>("list_habit_reminders"),

  get: (habitId: string) => invoke<HabitReminder>("habit_reminder", { habitId }),

  save: (habitId: string, reminder: HabitReminderInput) =>
    invoke<HabitReminder>("save_habit_reminder", { habitId, reminder }),

  status: () => invoke<NotificationStatus>("notification_status"),

  requestPermission: async (): Promise<PermissionState> => {
    if (!isTauri && typeof Notification !== "undefined") {
      const result = await Notification.requestPermission();
      return result === "granted" ? "granted" : "denied";
    }
    return invoke<PermissionState>("request_notification_permission");
  },

  test: (habitId: string) => invoke<void>("test_reminder", { habitId }),
};
