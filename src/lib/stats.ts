import { addDays, format, startOfWeek } from "date-fns";
import { dateKey } from "./api";
import type { Checkin, Habit, ScheduleType, SortMode } from "./types";

export const WEEK_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

/**
 * Индекс отметок: один раз строится в сторе и переиспользуется всеми view.
 * Ключ `habitId|date` даёт O(1) проверку вместо линейного some() по массиву.
 */
export interface CheckinIndex {
  keys: Set<string>;
  /** Даты конкретной привычки — для серий без фильтрации массива. */
  byHabit: Map<string, Set<string>>;
  /** Полная отметка (нужна для заметок). */
  byKey: Map<string, Checkin>;
  count: number;
}

/** Массив сохраняем для обратной совместимости, но везде внутри используем индекс. */
export type CheckinSource = Checkin[] | CheckinIndex;

const EMPTY_DATES: ReadonlySet<string> = new Set();

export const checkinKey = (habitId: string, date: string): string => `${habitId}|${date}`;

export function buildCheckinIndex(checkins: Checkin[]): CheckinIndex {
  const keys = new Set<string>();
  const byHabit = new Map<string, Set<string>>();
  const byKey = new Map<string, Checkin>();
  for (const checkin of checkins) {
    const key = checkinKey(checkin.habit_id, checkin.date);
    keys.add(key);
    byKey.set(key, checkin);
    let dates = byHabit.get(checkin.habit_id);
    if (!dates) {
      dates = new Set<string>();
      byHabit.set(checkin.habit_id, dates);
    }
    dates.add(checkin.date);
  }
  return { keys, byHabit, byKey, count: checkins.length };
}

const datesFor = (source: CheckinSource, habitId: string): ReadonlySet<string> => {
  if (!Array.isArray(source)) return source.byHabit.get(habitId) ?? EMPTY_DATES;
  const dates = new Set<string>();
  for (const item of source) if (item.habit_id === habitId) dates.add(item.date);
  return dates;
};

const sourceCount = (source: CheckinSource): number =>
  Array.isArray(source) ? source.length : source.count;

export const isoWeekday = (date: Date): number => ((date.getDay() + 6) % 7) + 1;

export function scheduleDays(habit: Habit): number[] {
  if (habit.schedule_type === "weekdays") return [1, 2, 3, 4, 5];
  if (habit.schedule_type === "weekends") return [6, 7];
  if (habit.schedule_type === "custom") {
    const days = (habit.weekdays ?? []).filter((day) => day >= 1 && day <= 7);
    return days.length ? [...new Set(days)].sort((a, b) => a - b) : [1, 2, 3, 4, 5, 6, 7];
  }
  return [1, 2, 3, 4, 5, 6, 7];
}

export function isScheduled(habit: Habit, date: Date): boolean {
  return scheduleDays(habit).includes(isoWeekday(date));
}

export function scheduledHabits(habits: Habit[], date: Date): Habit[] {
  return habits.filter((habit) => !habit.archived && isScheduled(habit, date));
}

export function scheduleLabel(habit: Habit): string {
  const type: ScheduleType = habit.schedule_type ?? "daily";
  if (type === "weekdays") return "Будни";
  if (type === "weekends") return "Выходные";
  if (type === "custom") {
    const days = scheduleDays(habit);
    if (days.length === 7) return "Каждый день";
    return days.map((day) => WEEK_LABELS[day - 1]).join(", ");
  }
  return "Каждый день";
}

export const isChecked = (source: CheckinSource, habitId: string, date: string): boolean =>
  Array.isArray(source)
    ? source.some((checkin) => checkin.habit_id === habitId && checkin.date === date)
    : source.keys.has(checkinKey(habitId, date));

export const checkinAt = (
  source: CheckinSource,
  habitId: string,
  date: string,
): Checkin | undefined =>
  Array.isArray(source)
    ? source.find((item) => item.habit_id === habitId && item.date === date)
    : source.byKey.get(checkinKey(habitId, date));

export function dayWord(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "день";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "дня";
  return "дней";
}

/** Серия без обрывов в дни, когда привычка не запланирована. */
export function currentStreak(
  source: CheckinSource,
  habit: Habit,
  today = new Date(),
): number {
  const dates = datesFor(source, habit.id);
  let cursor = new Date(today);
  // Незакрытый сегодня день ещё не обрывает серию.
  if (isScheduled(habit, cursor) && !dates.has(dateKey(cursor))) {
    cursor = addDays(cursor, -1);
  }

  let streak = 0;
  for (let guard = 0; guard < 400; guard += 1) {
    if (!isScheduled(habit, cursor)) {
      cursor = addDays(cursor, -1);
      continue;
    }
    if (!dates.has(dateKey(cursor))) break;
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/** Рекорд серии: окно ограничено 400 днями, чтобы не обходить всю историю. */
export function longestStreak(
  source: CheckinSource,
  habit: Habit,
  today = new Date(),
): number {
  const dates = datesFor(source, habit.id);
  const start = new Date(`${habit.created_at.slice(0, 10)}T00:00:00`);
  const windowStart = addDays(today, -400);
  const cursorStart =
    Number.isNaN(start.getTime()) || start < windowStart ? windowStart : start;
  let run = 0;
  let best = 0;

  for (let cursor = cursorStart; cursor <= today; cursor = addDays(cursor, 1)) {
    if (!isScheduled(habit, cursor)) continue;
    if (dates.has(dateKey(cursor))) {
      run += 1;
      best = Math.max(best, run);
    } else {
      run = 0;
    }
  }
  return best;
}

export function weekDays(date = new Date()): Date[] {
  const monday = startOfWeek(date, { weekStartsOn: 1 });
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

export function lastDays(count: number, today = new Date()): Date[] {
  return Array.from({ length: count }, (_, index) => addDays(today, index - count + 1));
}

export function completionRate(
  source: CheckinSource,
  habit: Habit,
  days = 30,
  today = new Date(),
): number {
  const window = lastDays(days, today).filter((day) => isScheduled(habit, day));
  if (window.length === 0) return 0;
  const done = window.filter((day) => isChecked(source, habit.id, dateKey(day))).length;
  return Math.round((done / window.length) * 100);
}

export interface DaySummary {
  date: string;
  label: string;
  done: number;
  total: number;
  percent: number;
}

export function daySummaries(
  habits: Habit[],
  source: CheckinSource,
  days: number,
  today = new Date(),
): DaySummary[] {
  const active = habits.filter((habit) => !habit.archived);
  return lastDays(days, today).map((day) => {
    const key = dateKey(day);
    const planned = scheduledHabits(active, day);
    const done = planned.filter((habit) => isChecked(source, habit.id, key)).length;
    return {
      date: key,
      label: format(day, "d MMM"),
      done,
      total: planned.length,
      percent: planned.length === 0 ? 0 : Math.round((done / planned.length) * 100),
    };
  });
}

export function overallStats(habits: Habit[], source: CheckinSource, today = new Date()) {
  const active = habits.filter((habit) => !habit.archived);
  const plannedToday = scheduledHabits(active, today);
  const summaries = daySummaries(active, source, 30, today);
  const average = summaries.length
    ? Math.round(summaries.reduce((sum, day) => sum + day.percent, 0) / summaries.length)
    : 0;
  const bestStreak = active.reduce(
    (best, habit) => Math.max(best, currentStreak(source, habit, today)),
    0,
  );
  return {
    totalHabits: active.length,
    todayDone: plannedToday.filter((habit) => isChecked(source, habit.id, dateKey(today))).length,
    todayTotal: plannedToday.length,
    average,
    bestStreak,
    totalCheckins: sourceCount(source),
  };
}

export function weeklyProgress(
  source: CheckinSource,
  habit: Habit,
  today = new Date(),
): { done: number; target: number; percent: number; complete: boolean } {
  const days = weekDays(today);
  const done = days.filter((day) => isChecked(source, habit.id, dateKey(day))).length;
  const target = Math.max(1, habit.target_per_week ?? 7);
  return {
    done,
    target,
    percent: Math.min(100, Math.round((done / target) * 100)),
    complete: done >= target,
  };
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  unlocked: boolean;
}

export function achievements(
  habits: Habit[],
  source: CheckinSource,
  averageOverride?: number,
): Achievement[] {
  const active = habits.filter((habit) => !habit.archived);
  const streaks = active.map((habit) => currentStreak(source, habit));
  const best = Math.max(0, ...streaks);
  const goalsReached = active.filter((habit) => weeklyProgress(source, habit).complete).length;
  // Среднее уже посчитано в StatsView — не делаем вторую серию daySummaries.
  const average = averageOverride ?? overallStats(habits, source).average;
  const total = sourceCount(source);
  return [
    {
      id: "first",
      title: "Первый шаг",
      description: "Первая отметка в приложении",
      unlocked: total > 0,
    },
    {
      id: "week",
      title: "Неделя подряд",
      description: "Серия из 7 дней",
      unlocked: best >= 7,
    },
    {
      id: "goal",
      title: "Цель недели",
      description: "Недельная цель выполнена",
      unlocked: goalsReached > 0,
    },
    {
      id: "thirty",
      title: "30 отметок",
      description: "Всего 30 выполненных дней",
      unlocked: total >= 30,
    },
    {
      id: "steady",
      title: "Стабильность",
      description: "Среднее за 30 дней ≥ 80%",
      unlocked: average >= 80,
    },
    {
      id: "master",
      title: "Мастер ритма",
      description: "Серия из 30 дней",
      unlocked: best >= 30,
    },
  ];
}

export function filterAndSortHabits(
  habits: Habit[],
  source: CheckinSource,
  options: {
    query?: string;
    category?: string;
    sort?: SortMode;
    today?: Date;
  },
): Habit[] {
  const { query = "", category = "all", sort = "manual", today = new Date() } = options;
  const needle = query.toLowerCase().trim();
  const result = habits.filter((habit) => {
    const categoryMatch = category === "all" || habit.category === category;
    const queryMatch =
      !needle ||
      habit.name.toLowerCase().includes(needle) ||
      habit.description.toLowerCase().includes(needle);
    return categoryMatch && queryMatch;
  });

  if (sort === "name") {
    return result.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }
  if (sort === "target") {
    return result.sort(
      (a, b) =>
        b.target_per_week - a.target_per_week ||
        a.sort_order - b.sort_order ||
        a.name.localeCompare(b.name, "ru"),
    );
  }
  if (sort === "streak") {
    // Серии считаем один раз до сортировки, а не в каждом сравнении.
    const streaks = new Map(result.map((habit) => [habit.id, currentStreak(source, habit, today)]));
    return result.sort(
      (a, b) => (streaks.get(b.id) ?? 0) - (streaks.get(a.id) ?? 0) || a.sort_order - b.sort_order,
    );
  }
  return result.sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
}
