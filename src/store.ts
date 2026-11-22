import { create } from "zustand";
import { useReminders } from "./features/reminders/store";
import { api, dateKey } from "./lib/api";
import { buildCheckinIndex, checkinKey, type CheckinIndex } from "./lib/stats";
import { applySettings, DEFAULT_SETTINGS } from "./lib/theme";
import type {
  Checkin,
  Habit,
  NewHabit,
  NowInfo,
  Settings,
  ShapeId,
  SortMode,
  ViewId,
} from "./lib/types";

const SETTINGS_KEY = "voidtrack:settings:v1";
const isAndroid =
  typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);

interface Toast {
  id: number;
  text: string;
}

interface AppState {
  habits: Habit[];
  checkins: Checkin[];
  /** Производный индекс: обновляется вместе с checkins, чтение — O(1). */
  checkinIndex: CheckinIndex;
  loading: boolean;
  view: ViewId;
  selectedDate: string;
  query: string;
  dialogOpen: boolean;
  editingId: string | null;
  customizeOpen: boolean;
  settingsTab: "appearance" | "reminders" | "data";
  showAll: boolean;
  categoryFilter: string;
  sortMode: SortMode;
  effectsEnabled: boolean;
  settings: Settings;
  now: NowInfo;
  pulse: number;
  toast: Toast | null;
  load: () => Promise<void>;
  refreshNow: () => Promise<void>;
  setView: (view: ViewId) => void;
  setSelectedDate: (date: string) => void;
  setQuery: (query: string) => void;
  setShowAll: (value: boolean) => void;
  setCategoryFilter: (value: string) => void;
  setSortMode: (value: SortMode) => void;
  openDialog: (id?: string) => void;
  closeDialog: () => void;
  setCustomizeOpen: (value: boolean, tab?: "appearance" | "reminders" | "data") => void;
  toggleEffects: () => void;
  updateSettings: (patch: Partial<Settings>) => void;
  triggerPulse: () => void;
  toggleCheckin: (habitId: string, date: string) => Promise<void>;
  setCheckinNote: (habitId: string, date: string, note: string) => Promise<void>;
  moveHabit: (id: string, delta: number) => Promise<void>;
  replaceData: (habits: Habit[], checkins: Checkin[]) => void;
  saveHabit: (input: NewHabit, id?: string) => Promise<string | null>;
  deleteHabit: (id: string) => Promise<void>;
  archiveHabit: (id: string, archived: boolean) => Promise<void>;
  notify: (text: string) => void;
}

function readSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return isAndroid ? { ...DEFAULT_SETTINGS, shape: "off" } : DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    // Раньше здесь были декоративные фигуры; их значения больше не существуют.
    // На Android WebGL отключаем по умолчанию: это самый частый источник
    // немедленного падения на мобильных WebView.
    const shape: ShapeId = isAndroid || parsed.shape === "off" ? "off" : "week";
    return { ...DEFAULT_SETTINGS, ...parsed, shape };
  } catch {
    return isAndroid ? { ...DEFAULT_SETTINGS, shape: "off" } : DEFAULT_SETTINGS;
  }
}

function fallbackNow(): NowInfo {
  const date = new Date();
  return {
    date: dateKey(date),
    time: `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`,
    weekday_ru: "",
    weekday_short: "",
    month_ru: "",
    label: "",
    iso_weekday: ((date.getDay() + 6) % 7) + 1,
  };
}

const sameNow = (a: NowInfo, b: NowInfo): boolean =>
  a.date === b.date &&
  a.time === b.time &&
  a.weekday_ru === b.weekday_ru &&
  a.weekday_short === b.weekday_short &&
  a.month_ru === b.month_ru &&
  a.label === b.label &&
  a.iso_weekday === b.iso_weekday;

/** Индекс пересчитывается только при изменении самих отметок. */
const withCheckins = (checkins: Checkin[]) => ({
  checkins,
  checkinIndex: buildCheckinIndex(checkins),
});

/**
 * Обновление даты ровно в местную полночь + проверка при возврате в приложение.
 * На Android фоновые таймеры WebView засыпают, поэтому 60-секундный guard
 * заменён событием visibilitychange: он не дёргает IPC каждую минуту.
 */
function watchMidnight(refresh: () => void): () => void {
  let timer = 0;
  let disposed = false;
  let lastDate = dateKey(new Date());

  const check = () => {
    if (disposed) return;
    const current = dateKey(new Date());
    if (current === lastDate) return;
    lastDate = current;
    refresh();
  };

  const schedule = () => {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 2);
    timer = window.setTimeout(() => {
      if (disposed) return;
      check();
      schedule();
    }, Math.max(1000, next.getTime() - now.getTime()));
  };

  schedule();
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", check);
  return () => {
    disposed = true;
    window.clearTimeout(timer);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", check);
  };
}

const initialSettings = typeof window === "undefined" ? DEFAULT_SETTINGS : readSettings();
if (typeof window !== "undefined") applySettings(initialSettings);

let stopMidnight: (() => void) | null = null;

export const useApp = create<AppState>((set, get) => ({
  habits: [],
  checkins: [],
  checkinIndex: buildCheckinIndex([]),
  loading: true,
  view: "today",
  selectedDate: dateKey(new Date()),
  query: "",
  dialogOpen: false,
  editingId: null,
  customizeOpen: false,
  settingsTab: "appearance",
  showAll: false,
  categoryFilter: "all",
  sortMode: "manual",
  effectsEnabled: initialSettings.shape !== "off",
  settings: initialSettings,
  now: fallbackNow(),
  pulse: 0,
  toast: null,

  load: async () => {
    try {
      const [{ habits, checkins }, now] = await Promise.all([
        api.getAppData(),
        api.nowInfo(),
        useReminders.getState().load(),
      ]);
      const today = dateKey(new Date());
      const normalized = checkins.map((checkin) => ({ ...checkin, note: checkin.note ?? "" }));
      set({
        habits: [...habits].sort(
          (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.created_at.localeCompare(b.created_at),
        ),
        ...withCheckins(normalized),
        now,
        selectedDate: today,
        loading: false,
      });
      stopMidnight?.();
      stopMidnight = watchMidnight(() => void get().refreshNow());
    } catch (error) {
      set({ loading: false });
      get().notify(error instanceof Error ? error.message : "Не удалось загрузить данные");
    }
  },

  refreshNow: async () => {
    try {
      const now = await api.nowInfo();
      const state = get();
      const today = dateKey(new Date());
      const selectedDate = state.selectedDate === state.now.date ? today : state.selectedDate;
      // Ничего не менялось — не трогаем стор и не перерисовываем TopBar.
      if (sameNow(state.now, now) && selectedDate === state.selectedDate) return;
      set({ now, selectedDate });
    } catch {
      // Оставляем предыдущую дату — сеть/bridge временно недоступны.
    }
  },

  setView: (view) => set({ view }),
  setSelectedDate: (selectedDate) => set({ selectedDate }),
  setQuery: (query) => set({ query }),
  setShowAll: (showAll) => set({ showAll }),
  setCategoryFilter: (categoryFilter) => set({ categoryFilter }),
  setSortMode: (sortMode) => set({ sortMode }),
  openDialog: (id) => set({ dialogOpen: true, editingId: id ?? null }),
  closeDialog: () => set({ dialogOpen: false, editingId: null }),
  setCustomizeOpen: (customizeOpen, tab) =>
    set(tab ? { customizeOpen, settingsTab: tab } : { customizeOpen }),

  toggleEffects: () =>
    set((state) => {
      const shape: ShapeId = state.effectsEnabled ? "off" : "week";
      const settings = { ...state.settings, shape };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      applySettings(settings);
      return { effectsEnabled: !state.effectsEnabled, settings };
    }),

  updateSettings: (patch) =>
    set((state) => {
      const settings = { ...state.settings, ...patch };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      applySettings(settings);
      return {
        settings,
        effectsEnabled: settings.shape !== "off",
      };
    }),

  triggerPulse: () => set((state) => ({ pulse: state.pulse + 1 })),

  toggleCheckin: async (habitId, date) => {
    const previous = get().checkins;
    const previousIndex = get().checkinIndex;
    const key = checkinKey(habitId, date);
    const exists = previousIndex.keys.has(key);
    set(
      withCheckins(
        exists
          ? previous.filter((item) => checkinKey(item.habit_id, item.date) !== key)
          : [
              ...previous,
              {
                id: `temp-${Date.now()}`,
                habit_id: habitId,
                date,
                created_at: new Date().toISOString(),
                note: "",
              },
            ],
      ),
    );
    get().triggerPulse();
    try {
      const checked = await api.toggleCheckin(habitId, date);
      const current = get().checkins;
      if (checked) {
        set(
          withCheckins(
            current.map((item) =>
              checkinKey(item.habit_id, item.date) === key && item.id.startsWith("temp-")
                ? { ...item, id: `saved-${Date.now()}` }
                : item,
            ),
          ),
        );
      } else {
        set(
          withCheckins(
            current.filter((item) => checkinKey(item.habit_id, item.date) !== key),
          ),
        );
      }
    } catch {
      set({ checkins: previous, checkinIndex: previousIndex });
      get().notify("Не удалось сохранить отметку");
    }
  },

  setCheckinNote: async (habitId, date, note) => {
    const previous = get().checkins;
    const previousIndex = get().checkinIndex;
    const key = checkinKey(habitId, date);
    set(
      withCheckins(
        previous.map((item) =>
          checkinKey(item.habit_id, item.date) === key ? { ...item, note } : item,
        ),
      ),
    );
    try {
      await api.setCheckinNote(habitId, date, note);
    } catch {
      set({ checkins: previous, checkinIndex: previousIndex });
      get().notify("Не удалось сохранить заметку");
    }
  },

  moveHabit: async (id, delta) => {
    const ordered = [...get().habits].sort(
      (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
    );
    const index = ordered.findIndex((habit) => habit.id === id);
    const next = index + delta;
    if (index < 0 || next < 0 || next >= ordered.length) return;
    [ordered[index], ordered[next]] = [ordered[next], ordered[index]];
    const previous = get().habits;
    set({ habits: ordered.map((habit, position) => ({ ...habit, sort_order: position })) });
    try {
      await api.reorderHabits(ordered.map((habit) => habit.id));
    } catch {
      set({ habits: previous });
      get().notify("Не удалось изменить порядок");
    }
  },

  replaceData: (habits, checkins) => {
    set({
      habits: [...habits].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
      ...withCheckins(checkins.map((checkin) => ({ ...checkin, note: checkin.note ?? "" }))),
    });
    void useReminders.getState().refresh();
  },

  saveHabit: async (input, id) => {
    try {
      if (id) {
        const updated = await api.updateHabit(id, input);
        set((state) => ({
          habits: state.habits.map((habit) => (habit.id === id ? updated : habit)),
        }));
        get().notify("Привычка обновлена");
        get().closeDialog();
        return id;
      }
      const habit = await api.createHabit(input);
      set((state) => ({ habits: [...state.habits, habit] }));
      get().notify("Привычка создана");
      get().closeDialog();
      return habit.id;
    } catch (error) {
      get().notify(error instanceof Error ? error.message : "Не удалось сохранить привычку");
      return null;
    }
  },

  deleteHabit: async (id) => {
    const previousHabits = get().habits;
    const previousCheckins = get().checkins;
    const previousIndex = get().checkinIndex;
    set({
      habits: previousHabits.filter((habit) => habit.id !== id),
      ...withCheckins(previousCheckins.filter((checkin) => checkin.habit_id !== id)),
    });
    try {
      await api.deleteHabit(id);
      void useReminders.getState().refresh();
      get().notify("Привычка удалена");
    } catch {
      set({ habits: previousHabits, checkins: previousCheckins, checkinIndex: previousIndex });
      get().notify("Не удалось удалить привычку");
    }
  },

  archiveHabit: async (id, archived) => {
    const previous = get().habits;
    set({
      habits: previous.map((habit) => (habit.id === id ? { ...habit, archived } : habit)),
    });
    try {
      await api.archiveHabit(id, archived);
      get().notify(archived ? "Привычка в архиве" : "Привычка восстановлена");
    } catch {
      set({ habits: previous });
      get().notify("Не удалось изменить архив");
    }
  },

  notify: (text) => {
    const toast = { id: Date.now(), text };
    set({ toast });
    window.setTimeout(() => {
      if (get().toast?.id === toast.id) set({ toast: null });
    }, 2800);
  },
}));

/** Селектор индекса: подписка только на него не реагирует на другие поля стора. */
export const useCheckinIndex = (): CheckinIndex => useApp((state) => state.checkinIndex);
