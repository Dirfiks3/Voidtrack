import {
  DEFAULT_REMINDER_SETTINGS,
  defaultReminder,
  normalizeDays,
  reminderBody,
  reminderTitle,
} from "../features/reminders/defaults";
import type {
  AppData,
  Checkin,
  Habit,
  HabitReminder,
  HabitReminderInput,
  NewHabit,
  NowInfo,
  ImportSummary,
  LogEntry,
  ReminderSettings,
  Suggestion,
} from "./types";

const HABITS_KEY = "voidtrack:habits:v1";
const CHECKINS_KEY = "voidtrack:checkins:v1";
const REMINDERS_KEY = "voidtrack:reminders:v1";
const REMINDER_SETTINGS_KEY = "voidtrack:reminder-settings:v1";
const LEGACY_HABITS_KEY = "trackpriv:habits:v1";
const LEGACY_CHECKINS_KEY = "trackpriv:checkins:v1";

type GlobalWithTauri = typeof globalThis & { __TAURI_INTERNALS__?: unknown };
export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in (window as GlobalWithTauri);

export const dateKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const uid = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const withSchedule = <T extends Partial<Habit>>(
  habit: T,
): T & Pick<Habit, "schedule_type" | "weekdays" | "sort_order"> => ({
  ...habit,
  schedule_type: habit.schedule_type ?? "daily",
  weekdays: habit.weekdays ?? [1, 2, 3, 4, 5, 6, 7],
  sort_order: habit.sort_order ?? 0,
});

const escapeTrack = (value: string): string =>
  value.replace(/\\/g, "\\\\").replace(/\r/g, "\\r").replace(/\n/g, "\\n");

const unescapeTrack = (value: string): string => {
  let out = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char !== "\\" || index + 1 >= value.length) {
      out += char;
      continue;
    }
    const next = value[index + 1];
    out += next === "n" ? "\n" : next === "r" ? "\r" : next;
    index += 1;
  }
  return out;
};

const validDate = (value: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime());

type TrackBlock = Record<string, string>;

function parseTrack(content: string): { habits: Habit[]; checkins: Checkin[]; skipped: number } {
  if (content.length > 8 * 1024 * 1024) throw new Error("Файл слишком большой (максимум 8 МБ)");
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  const header = lines.find((line) => line.trim() && !line.trim().startsWith("#"))?.trim();
  if (!header || !header.startsWith("VOIDTRACK")) throw new Error("Это не файл VoidTrack (.track)");

  const sections: Record<string, TrackBlock[]> = { habits: [], checkins: [] };
  let section = "";
  let block: TrackBlock = {};
  const flush = () => {
    if (Object.keys(block).length > 0) {
      if (section === "habits" || section === "checkins") sections[section].push(block);
      block = {};
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("VOIDTRACK") || line.startsWith("[")) {
      flush();
      section = line.startsWith("[") ? line.slice(1, -1).trim().toLowerCase() : "";
      continue;
    }
    const divider = line.indexOf("=");
    if (divider === -1) continue;
    block[line.slice(0, divider).trim().toLowerCase()] = line.slice(divider + 1).trim();
  }
  flush();

  for (const blocks of Object.values(sections)) {
    for (const block of blocks) {
      for (const key of Object.keys(block)) block[key] = unescapeTrack(block[key]);
    }
  }

  let skipped = 0;
  const habits: Habit[] = sections.habits
    .filter((item) => item.id && item.name)
    .map((item, index) => {
      const schedule = ["daily", "weekdays", "weekends", "custom"].includes(item.schedule_type ?? "")
        ? (item.schedule_type as Habit["schedule_type"])
        : "daily";
      const weekdays = (item.weekdays ?? "")
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value >= 1 && value <= 7);
      return withSchedule({
        id: item.id,
        name: item.name,
        description: item.description ?? "",
        icon: item.icon ?? "sparkles",
        color: item.color ?? "violet",
        category: item.category ?? "Развитие",
        created_at: item.created_at ?? new Date().toISOString(),
        archived: item.archived === "1",
        target_per_week: Math.min(7, Math.max(1, Number(item.target_per_week) || 7)),
        schedule_type: schedule,
        weekdays: weekdays.length ? [...new Set(weekdays)].sort((a, b) => a - b) : [1, 2, 3, 4, 5, 6, 7],
        sort_order: Number.isFinite(Number(item.sort_order)) ? Number(item.sort_order) : index,
      });
    });

  const known = new Set(habits.map((habit) => habit.id));
  const checkins: Checkin[] = [];
  for (const item of sections.checkins) {
    if (!item.id || !item.habit_id || !validDate(item.date ?? "")) {
      skipped += 1;
      continue;
    }
    if (!known.has(item.habit_id)) {
      skipped += 1;
      continue;
    }
    checkins.push({
      id: item.id,
      habit_id: item.habit_id,
      date: item.date,
      created_at: item.created_at || new Date().toISOString(),
      note: (item.note ?? "").slice(0, 4000),
    });
  }
  return { habits, checkins, skipped };
}

function serializeTrack(data: AppData): string {
  const lines: string[] = ["# VoidTrack backup — текстовый формат", "VOIDTRACK 1", "", "[habits]"];
  for (const habit of data.habits) {
    lines.push(
      `id=${escapeTrack(habit.id)}`,
      `name=${escapeTrack(habit.name)}`,
      `description=${escapeTrack(habit.description)}`,
      `icon=${escapeTrack(habit.icon)}`,
      `color=${escapeTrack(habit.color)}`,
      `category=${escapeTrack(habit.category)}`,
      `created_at=${escapeTrack(habit.created_at)}`,
      `archived=${habit.archived ? 1 : 0}`,
      `target_per_week=${habit.target_per_week}`,
      `schedule_type=${habit.schedule_type}`,
      `weekdays=${(habit.weekdays ?? []).join(",")}`,
      `sort_order=${habit.sort_order ?? 0}`,
      "",
    );
  }
  lines.push("[checkins]");
  for (const checkin of data.checkins) {
    lines.push(
      `id=${escapeTrack(checkin.id)}`,
      `habit_id=${escapeTrack(checkin.habit_id)}`,
      `date=${checkin.date}`,
      `created_at=${escapeTrack(checkin.created_at)}`,
      `note=${escapeTrack(checkin.note ?? "")}`,
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}

function seedData(): AppData {
  const today = new Date();
  const base: NewHabit[] = [
    {
      name: "Утренняя медитация",
      description: "10 минут тишины с дыханием перед началом дня.",
      icon: "brain",
      color: "violet",
      category: "Ментальное",
      target_per_week: 7,
      schedule_type: "daily",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
    },
    {
      name: "Тренировка",
      description: "30 минут движения для тела и головы.",
      icon: "dumbbell",
      color: "rose",
      category: "Здоровье",
      target_per_week: 3,
      schedule_type: "custom",
      weekdays: [1, 3, 5],
    },
    {
      name: "Чтение 20 минут",
      description: "Книга вместо ленты — 20 минут без отвлечений.",
      icon: "book",
      color: "cyan",
      category: "Развитие",
      target_per_week: 5,
      schedule_type: "daily",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
    },
    {
      name: "Пить 2 литра воды",
      description: "8 стаканов воды ровно в течение дня.",
      icon: "water",
      color: "blue",
      category: "Здоровье",
      target_per_week: 7,
      schedule_type: "daily",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
    },
    {
      name: "Дневник благодарности",
      description: "Три вещи, за которые я сегодня благодарен.",
      icon: "pen",
      color: "pink",
      category: "Ментальное",
      target_per_week: 2,
      schedule_type: "custom",
      weekdays: [2, 4, 6],
    },
  ];

  const habits: Habit[] = base.map((habit, index) => ({
    ...habit,
    id: `seed-${index + 1}`,
    created_at: new Date(today.getTime() - 40 * 86_400_000).toISOString(),
    archived: false,
    sort_order: index,
  }));

  const checkins: Checkin[] = [];
  habits.forEach((habit, habitIndex) => {
    for (let daysAgo = 0; daysAgo < 28; daysAgo += 1) {
      const day = new Date(today);
      day.setDate(today.getDate() - daysAgo);
      const iso = ((day.getDay() + 6) % 7) + 1;
      const days =
        habit.schedule_type === "custom"
          ? habit.weekdays
          : habit.schedule_type === "weekdays"
            ? [1, 2, 3, 4, 5]
            : habit.schedule_type === "weekends"
              ? [6, 7]
              : [1, 2, 3, 4, 5, 6, 7];
      if (!days.includes(iso)) continue;
      const chance = 0.78 - habitIndex * 0.09;
      const shouldCheck =
        daysAgo === 0 ? habitIndex % 2 === 0 : (daysAgo * 7 + habitIndex * 3) % 10 < chance * 10;
      if (shouldCheck) {
        checkins.push({
          id: uid(),
          habit_id: habit.id,
          date: dateKey(day),
          created_at: day.toISOString(),
          note: "",
        });
      }
    }
  });

  return { habits, checkins };
}

function readCheckins(): Checkin[] {
  const parsed = JSON.parse(localStorage.getItem(CHECKINS_KEY) ?? "[]") as Checkin[];
  return parsed.map((checkin) => ({ ...checkin, note: checkin.note ?? "" }));
}

function readStore(): AppData {
  try {
    let habitsRaw = localStorage.getItem(HABITS_KEY);
    if (!habitsRaw) {
      const legacyHabits = localStorage.getItem(LEGACY_HABITS_KEY);
      if (legacyHabits) {
        const migrated: AppData = {
          habits: (JSON.parse(legacyHabits) as Habit[]).map(withSchedule),
          checkins: (JSON.parse(localStorage.getItem(LEGACY_CHECKINS_KEY) ?? "[]") as Checkin[]).map((checkin) => ({
            ...checkin,
            note: checkin.note ?? "",
          })),
        };
        localStorage.setItem(HABITS_KEY, JSON.stringify(migrated.habits));
        localStorage.setItem(CHECKINS_KEY, JSON.stringify(migrated.checkins));
        return migrated;
      }
      const seeded = seedData();
      localStorage.setItem(HABITS_KEY, JSON.stringify(seeded.habits));
      localStorage.setItem(CHECKINS_KEY, JSON.stringify(seeded.checkins));
      return seeded;
    }
    const parsed = JSON.parse(habitsRaw) as Habit[];
    // Новый ключ может существовать, но быть пустым после старого ребрендинга.
    // Если есть легаси-данные — переносим их, иначе уважаем намеренно пустой список.
    if (parsed.length === 0) {
      const legacyHabits = localStorage.getItem(LEGACY_HABITS_KEY);
      if (legacyHabits) {
        const migrated: AppData = {
          habits: (JSON.parse(legacyHabits) as Habit[]).map(withSchedule),
          checkins: (JSON.parse(localStorage.getItem(LEGACY_CHECKINS_KEY) ?? "[]") as Checkin[]).map((checkin) => ({
            ...checkin,
            note: checkin.note ?? "",
          })),
        };
        localStorage.setItem(HABITS_KEY, JSON.stringify(migrated.habits));
        localStorage.setItem(CHECKINS_KEY, JSON.stringify(migrated.checkins));
        return migrated;
      }
    }
    const habits = parsed.map(withSchedule);
    if (habits.some((habit, index) => habit !== parsed[index])) {
      localStorage.setItem(HABITS_KEY, JSON.stringify(habits));
    }
    return { habits, checkins: readCheckins() };
  } catch {
    const seeded = seedData();
    localStorage.setItem(HABITS_KEY, JSON.stringify(seeded.habits));
    localStorage.setItem(CHECKINS_KEY, JSON.stringify(seeded.checkins));
    return seeded;
  }
}

function writeStore(data: AppData): void {
  localStorage.setItem(HABITS_KEY, JSON.stringify(data.habits));
  localStorage.setItem(CHECKINS_KEY, JSON.stringify(data.checkins));
}

const normalize = (value: string): string => value.toLowerCase().replace(/ё/g, "е").trim();

function fuzzy(text: string, query: string): number {
  let cursor = 0;
  let run = 0;
  let score = 0;
  for (const char of text) {
    if (char === query[cursor]) {
      cursor += 1;
      run += 1;
      score += 3 + run;
      if (cursor === query.length) break;
    } else {
      run = 0;
    }
  }
  return cursor === query.length ? score : 0;
}

function textScore(text: string, query: string): number {
  if (!query) return 0;
  const source = normalize(text);
  const needle = normalize(query);
  let score = fuzzy(source, needle);
  if (source === needle) score += 90;
  else if (source.startsWith(needle)) score += 45;
  else if (source.includes(needle)) score += 25;
  return score;
}

async function demoSuggest(query: string, limit: number): Promise<Suggestion[]> {
  // Каталог нужен только демо-режима; в Tauri-сборке он не попадает в стартовый чанк.
  const { default: catalog } = await import("../../shared/catalog.json");
  const needle = normalize(query);
  if (!needle) {
    const popular = catalog.filter((item) => item.popular);
    return (popular.length ? popular : catalog)
      .slice(0, limit)
      .map((item) => ({ ...item, score: 100 }));
  }
  return catalog
    .map((item) => {
      const score = Math.max(
        textScore(item.name, needle) * 1.8,
        ...item.keywords.map((keyword) => textScore(keyword, needle) * 1.35),
        textScore(item.category, needle) * 0.65,
        textScore(item.description, needle) * 0.32,
      ) + (item.popular ? 12 : 0);
      return { ...item, score };
    })
    .filter((item) => item.score > 45)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function demoNow(): NowInfo {
  const day = new Date();
  const weekdays = [
    "воскресенье",
    "понедельник",
    "вторник",
    "среда",
    "четверг",
    "пятница",
    "суббота",
  ];
  const short = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
  const months = [
    "января",
    "февраля",
    "марта",
    "апреля",
    "мая",
    "июня",
    "июля",
    "августа",
    "сентября",
    "октября",
    "ноября",
    "декабря",
  ];
  const wd = day.getDay();
  return {
    date: dateKey(day),
    time: `${String(day.getHours()).padStart(2, "0")}:${String(day.getMinutes()).padStart(2, "0")}`,
    weekday_ru: weekdays[wd],
    weekday_short: short[wd],
    month_ru: months[day.getMonth()],
    label: `${day.getDate()} ${months[day.getMonth()]} ${day.getFullYear()}, ${weekdays[wd]}`,
    iso_weekday: ((wd + 6) % 7) + 1,
  };
}

function demoStreak(habitId: string): number {
  const store = readStore();
  const habit = store.habits.find((item) => item.id === habitId);
  if (!habit) return 0;
  const done = new Set(
    store.checkins.filter((item) => item.habit_id === habitId).map((item) => item.date),
  );
  const scheduled = (date: Date): boolean => {
    const iso = ((date.getDay() + 6) % 7) + 1;
    if (habit.schedule_type === "weekdays") return iso <= 5;
    if (habit.schedule_type === "weekends") return iso >= 6;
    return (habit.weekdays ?? [1, 2, 3, 4, 5, 6, 7]).includes(iso);
  };
  const cursor = new Date();
  if (scheduled(cursor) && !done.has(dateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  for (let guard = 0; guard < 400; guard += 1) {
    if (!scheduled(cursor)) {
      cursor.setDate(cursor.getDate() - 1);
      continue;
    }
    if (!done.has(dateKey(cursor))) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function readReminderSettings(): ReminderSettings {
  try {
    const raw = localStorage.getItem(REMINDER_SETTINGS_KEY);
    return raw
      ? { ...DEFAULT_REMINDER_SETTINGS, ...(JSON.parse(raw) as Partial<ReminderSettings>) }
      : { ...DEFAULT_REMINDER_SETTINGS };
  } catch {
    return { ...DEFAULT_REMINDER_SETTINGS };
  }
}

function readReminders(store: AppData): HabitReminder[] {
  const settings = readReminderSettings();
  let stored: HabitReminder[] = [];
  try {
    stored = JSON.parse(localStorage.getItem(REMINDERS_KEY) ?? "[]") as HabitReminder[];
  } catch {
    stored = [];
  }
  const byId = new Map(stored.map((reminder) => [reminder.habit_id, reminder]));
  return store.habits.map((habit) => byId.get(habit.id) ?? defaultReminder(habit, settings));
}

function writeReminders(reminders: HabitReminder[]): void {
  localStorage.setItem(REMINDERS_KEY, JSON.stringify(reminders));
}

function normalizeReminderInput(
  habit: Habit,
  input: HabitReminderInput,
  settings: ReminderSettings,
): HabitReminder {
  const mode = input.mode === "times" ? "times" : "interval";
  const minutes = Math.min(1440, Math.max(30, Math.round(input.interval_minutes) || 210));
  const times = Array.from(new Set(input.times.map((value) => value.trim()).filter(Boolean))).sort();
  const title = input.title.trim() || reminderTitle(habit.name);
  const body = input.body.trim() || reminderBody(habit.name);
  return {
    habit_id: habit.id,
    enabled: input.enabled,
    mode,
    interval_minutes: minutes || settings.default_interval_minutes,
    times: times.length ? times : ["09:00"],
    days: normalizeDays(input.days),
    title,
    body,
    skip_if_done: input.skip_if_done,
    last_fired_slot: null,
  };
}

async function demoInvoke<T>(command: string, args: Record<string, unknown>): Promise<T> {
  const store = readStore();
  switch (command) {
    case "list_habits":
      return store.habits as T;
    case "list_checkins":
      return store.checkins as T;
    case "create_habit": {
      const habit: Habit = withSchedule({
        ...(args.input as NewHabit),
        id: uid(),
        created_at: new Date().toISOString(),
        archived: false,
        sort_order: store.habits.reduce((max, item) => Math.max(max, item.sort_order ?? 0), -1) + 1,
      });
      writeStore({ ...store, habits: [...store.habits, habit] });
      return habit as T;
    }
    case "update_habit": {
      const index = store.habits.findIndex((habit) => habit.id === args.id);
      if (index === -1) throw new Error("Привычка не найдена");
      const updated: Habit = withSchedule({
        ...store.habits[index],
        ...(args.input as NewHabit),
      });
      const habits = [...store.habits];
      habits[index] = updated;
      writeStore({ ...store, habits });
      return updated as T;
    }
    case "archive_habit": {
      const habits = store.habits.map((habit) =>
        habit.id === args.id ? { ...habit, archived: Boolean(args.archived) } : habit,
      );
      writeStore({ ...store, habits });
      return undefined as T;
    }
    case "delete_habit": {
      const id = args.id as string;
      writeStore({
        habits: store.habits.filter((habit) => habit.id !== id),
        checkins: store.checkins.filter((checkin) => checkin.habit_id !== id),
      });
      writeReminders(readReminders(store).filter((reminder) => reminder.habit_id !== id));
      return undefined as T;
    }
    case "toggle_checkin": {
      const habitId = args.habitId as string;
      const date = args.date as string;
      const existing = store.checkins.find(
        (checkin) => checkin.habit_id === habitId && checkin.date === date,
      );
      if (existing) {
        writeStore({
          ...store,
          checkins: store.checkins.filter((checkin) => checkin.id !== existing.id),
        });
        return false as T;
      }
      const checkin: Checkin = {
        id: uid(),
        habit_id: habitId,
        date,
        created_at: new Date().toISOString(),
        note: "",
      };
      writeStore({ ...store, checkins: [...store.checkins, checkin] });
      return true as T;
    }
    case "habit_streak":
      return demoStreak(args.habitId as string) as T;
    case "now":
      return demoNow() as T;
    case "suggest_habits":
      return (await demoSuggest((args.query as string) ?? "", (args.limit as number) ?? 6)) as T;
    case "reminder_settings":
      return readReminderSettings() as T;
    case "save_reminder_settings": {
      const settings = {
        ...readReminderSettings(),
        ...(args.settings as Partial<ReminderSettings>),
      };
      localStorage.setItem(REMINDER_SETTINGS_KEY, JSON.stringify(settings));
      return settings as T;
    }
    case "list_habit_reminders":
      return readReminders(store) as T;
    case "habit_reminder": {
      const reminder = readReminders(store).find((item) => item.habit_id === args.habitId);
      if (!reminder) throw new Error("Привычка не найдена");
      return reminder as T;
    }
    case "save_habit_reminder": {
      const habit = store.habits.find((item) => item.id === args.habitId);
      if (!habit) throw new Error("Привычка не найдена");
      const saved = normalizeReminderInput(
        habit,
        args.reminder as HabitReminderInput,
        readReminderSettings(),
      );
      const reminders = readReminders(store).filter((item) => item.habit_id !== habit.id);
      writeReminders([...reminders, saved]);
      return saved as T;
    }
    case "notification_status": {
      const settings = readReminderSettings();
      const active = readReminders(store).filter((item) => item.enabled).length;
      return {
        permission: "prompt",
        platform: "desktop",
        settings,
        active_habits: active,
        scheduled_count: active,
      } as T;
    }
    case "request_notification_permission":
      return "granted" as T;
    case "test_reminder": {
      const reminder = readReminders(store).find((item) => item.habit_id === args.habitId);
      if (reminder && typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification(reminder.title, { body: reminder.body });
      }
      return undefined as T;
    }
    case "set_checkin_note": {
      const note = String(args.note ?? "").slice(0, 4000).replace(/\r\n?/g, "\n");
      const index = store.checkins.findIndex(
        (item) => item.habit_id === args.habitId && item.date === args.date,
      );
      if (index === -1) throw new Error("Отметка не найдена");
      const checkins = store.checkins.map((item, position) =>
        position === index ? { ...item, note } : item,
      );
      writeStore({ ...store, checkins });
      return undefined as T;
    }
    case "reorder_habits": {
      const ids = (args.ids as string[]) ?? [];
      const positions = new Map(ids.map((id, index) => [id, index]));
      const rest = store.habits
        .filter((habit) => !positions.has(habit.id))
        .map((habit, index) => [habit.id, ids.length + index] as const);
      const order = new Map([...positions, ...rest]);
      const habits = store.habits
        .map((habit) => ({ ...habit, sort_order: order.get(habit.id) ?? 0 }))
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      writeStore({ ...store, habits });
      return undefined as T;
    }
    case "export_data":
      return serializeTrack(store) as T;
    case "import_data": {
      const parsed = parseTrack(String(args.content ?? ""));
      const mode = args.mode === "replace" ? "replace" : "merge";
      let habits = store.habits;
      let checkins = store.checkins;
      if (mode === "replace") {
        habits = parsed.habits;
        checkins = parsed.checkins;
      } else {
        const byId = new Map(habits.map((habit) => [habit.id, habit]));
        parsed.habits.forEach((habit) => byId.set(habit.id, habit));
        habits = [...byId.values()];
        const checkinById = new Map(checkins.map((checkin) => [checkin.id, checkin]));
        parsed.checkins.forEach((checkin) => checkinById.set(checkin.id, checkin));
        checkins = [...checkinById.values()];
      }
      writeStore({ habits, checkins });
      return {
        habits: parsed.habits.length,
        checkins: parsed.checkins.length,
        skipped: parsed.skipped,
      } as T;
    }
    case "append_log":
      return undefined as T;
    case "read_logs":
      return [] as T;
    case "clear_logs":
      return undefined as T;
    default:
      throw new Error(`Неизвестная команда: ${command}`);
  }
}

export async function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!isTauri) return demoInvoke<T>(command, args);
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(command, args);
}

export const api = {
  listHabits: () => invoke<Habit[]>("list_habits"),
  listCheckins: () => invoke<Checkin[]>("list_checkins"),
  createHabit: (input: NewHabit) => invoke<Habit>("create_habit", { input }),
  updateHabit: (id: string, input: NewHabit) => invoke<Habit>("update_habit", { id, input }),
  archiveHabit: (id: string, archived: boolean) =>
    invoke<void>("archive_habit", { id, archived }),
  deleteHabit: (id: string) => invoke<void>("delete_habit", { id }),
  toggleCheckin: (habitId: string, date: string) =>
    invoke<boolean>("toggle_checkin", { habitId, date }),
  setCheckinNote: (habitId: string, date: string, note: string) =>
    invoke<void>("set_checkin_note", { habitId, date, note }),
  reorderHabits: (ids: string[]) => invoke<void>("reorder_habits", { ids }),
  exportData: () => invoke<string>("export_data"),
  importData: (content: string, mode: "replace" | "merge") =>
    invoke<ImportSummary>("import_data", { content, mode }),
  appendLog: (level: string, message: string) =>
    invoke<void>("append_log", { level, message }),
  readLogs: (limit = 200) => invoke<LogEntry[]>("read_logs", { limit }),
  clearLogs: () => invoke<void>("clear_logs"),
  habitStreak: (habitId: string) => invoke<number>("habit_streak", { habitId }),
  nowInfo: () => invoke<NowInfo>("now"),
  suggest: (query: string, limit = 6) => invoke<Suggestion[]>("suggest_habits", { query, limit }),
  getAppData: async (): Promise<AppData> => {
    const [habits, checkins] = await Promise.all([api.listHabits(), api.listCheckins()]);
    return { habits, checkins };
  },
};
