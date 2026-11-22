import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { motion } from "motion/react";
import { Check, X } from "lucide-react";
import { api } from "../lib/api";
import { getIcon, ICON_NAMES } from "../lib/icons";
import { COLOR_NAMES, token } from "../lib/theme";
import type { Habit, HabitReminder, NewHabit, ScheduleType, Suggestion } from "../lib/types";
import { WEEK_LABELS } from "../lib/stats";
import HabitReminderEditor from "../features/reminders/HabitReminderEditor";
import { defaultReminder, toInput } from "../features/reminders/defaults";
import { useReminders } from "../features/reminders/store";
import { useApp } from "../store";

const EMPTY_FORM: NewHabit = {
  name: "",
  description: "",
  icon: "sparkles",
  color: "violet",
  category: "Развитие",
  target_per_week: 7,
  schedule_type: "daily",
  weekdays: [1, 2, 3, 4, 5, 6, 7],
};

const QUICK_ICONS = ICON_NAMES.slice(0, 20);

const SCHEDULES: Array<{ id: ScheduleType; label: string }> = [
  { id: "daily", label: "Каждый день" },
  { id: "weekdays", label: "Будни" },
  { id: "weekends", label: "Выходные" },
  { id: "custom", label: "Свои дни" },
];

export default function HabitDialog() {
  const open = useApp((state) => state.dialogOpen);
  const editingId = useApp((state) => state.editingId);
  const habits = useApp((state) => state.habits);
  const closeDialog = useApp((state) => state.closeDialog);
  const saveHabit = useApp((state) => state.saveHabit);
  const notify = useApp((state) => state.notify);
  const saveReminder = useReminders((state) => state.saveReminder);
  const testReminder = useReminders((state) => state.test);

  const [form, setForm] = useState<NewHabit>(EMPTY_FORM);
  const [reminder, setReminder] = useState<HabitReminder | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [thinking, setThinking] = useState(false);
  const requestId = useRef(0);
  const skipNextSuggest = useRef(false);

  const loadPopular = useCallback(() => {
    requestId.current += 1;
    const id = requestId.current;
    void api.suggest("", 6).then((result) => {
      if (id === requestId.current) {
        setSuggestions(result);
        setActiveIndex(0);
        setShowSuggestions(true);
      }
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const existing = editingId ? habits.find((habit) => habit.id === editingId) : null;
    setForm(
      existing
        ? {
            name: existing.name,
            description: existing.description,
            icon: existing.icon,
            color: existing.color,
            category: existing.category,
            target_per_week: existing.target_per_week,
            schedule_type: existing.schedule_type ?? "daily",
            weekdays: existing.weekdays ?? [1, 2, 3, 4, 5, 6, 7],
          }
        : EMPTY_FORM,
    );
    setSuggestions([]);
    setShowSuggestions(false);
    skipNextSuggest.current = true;

    let cancelled = false;
    void useReminders.getState().load().then(() => {
      if (cancelled) return;
      const state = useReminders.getState();
      const loaded = state.forHabit(existing ?? undefined);
      setReminder(
        loaded ?? defaultReminder(
          {
            ...(existing ?? EMPTY_FORM),
            id: "__draft__",
            created_at: "",
            archived: false,
            sort_order: 0,
          },
          state.settings,
        ),
      );
    });

    // Открытие диалога тоже считается фокусом: сразу показываем популярные.
    loadPopular();
    return () => {
      cancelled = true;
    };
  }, [open, editingId, habits, loadPopular]);

  useEffect(() => {
    if (!open || skipNextSuggest.current) {
      skipNextSuggest.current = false;
      return;
    }
    requestId.current += 1;
    const id = requestId.current;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const result = await api.suggest(form.name.trim(), 6);
        if (!cancelled && id === requestId.current) {
          setSuggestions(result);
          setShowSuggestions(result.length > 0);
          setActiveIndex(0);
        }
      } catch {
        if (!cancelled && id === requestId.current) setSuggestions([]);
      }
    }, 90);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [form.name, open]);

  const applySuggestion = (suggestion: Suggestion) => {
    requestId.current += 1;
    skipNextSuggest.current = true;
    setForm((current) => ({
      ...current,
      name: suggestion.name,
      description: suggestion.description,
      icon: suggestion.icon,
      color: suggestion.color,
      category: suggestion.category,
    }));
    setShowSuggestions(false);
    setSuggestions([]);
  };

  const askForDescription = async () => {
    const query = form.name.trim() || form.description.trim();
    if (!query) {
      notify("Введите название");
      return;
    }
    setThinking(true);
    try {
      const result = await api.suggest(query, 1);
      if (result.length > 0) {
        applySuggestion(result[0]);
        notify("Подобрано по смыслу");
      } else {
        notify("В каталоге нет совпадений");
      }
    } finally {
      setThinking(false);
    }
  };

  const handleNameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" && showSuggestions) {
      event.stopPropagation();
      requestId.current += 1;
      setShowSuggestions(false);
      return;
    }
    if (!showSuggestions || suggestions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      applySuggestion(suggestions[activeIndex]);
    }
  };

  const toggleWeekday = (day: number) => {
    setForm((current) => {
      const exists = current.weekdays.includes(day);
      const weekdays = exists
        ? current.weekdays.filter((value) => value !== day)
        : [...current.weekdays, day].sort((a, b) => a - b);
      return {
        ...current,
        schedule_type: "custom",
        weekdays: weekdays.length ? weekdays : [day],
      };
    });
  };

  const submit = () => {
    if (!form.name.trim()) {
      notify("Введите название");
      return;
    }
    void (async () => {
      const savedId = await saveHabit({ ...form, name: form.name.trim() }, editingId ?? undefined);
      if (!savedId || !reminder) return;
      try {
        await saveReminder(savedId, toInput(reminder));
      } catch (error) {
        notify(error instanceof Error ? error.message : "Не удалось сохранить напоминание");
      }
    })();
  };

  const existingHabit = editingId ? habits.find((habit) => habit.id === editingId) : undefined;
  const reminderHabit: Habit | null = reminder
    ? existingHabit ?? {
        ...form,
        id: "__draft__",
        created_at: "",
        archived: false,
        sort_order: 0,
      }
    : null;

  return (
    <>
      {open && (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDialog();
          }}
        >
          <motion.div
            className="glass dialog"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
              <div>
                <h2>{editingId ? "Редактировать привычку" : "Новая привычка"}</h2>
                <p className="dialog-sub">Каталог из 148 привычек · подсказки по смыслу</p>
              </div>
              <button className="icon-btn" onClick={closeDialog} aria-label="Закрыть">
                <X size={16} strokeWidth={1.5} />
              </button>
            </div>

            <div className="field">
              <label htmlFor="habit-name">Название</label>
              <input
                id="habit-name"
                className="input"
                value={form.name}
                autoFocus
                onChange={(event) => {
                  setForm((current) => ({ ...current, name: event.target.value }));
                  setShowSuggestions(true);
                }}
                onKeyDown={handleNameKeyDown}
                onFocus={loadPopular}
                placeholder="Утренняя медитация"
              />
              {showSuggestions && suggestions.length > 0 && (
                <div className="suggest-list">
                  <div className="suggest-hint">
                    {form.name.trim() ? "Совпадения · ↑↓ Enter Esc" : "Популярные подсказки"}
                  </div>
                  {suggestions.map((suggestion, index) => (
                    <button
                      key={suggestion.name}
                      className={`suggest-item${index === activeIndex ? " active" : ""}`}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => applySuggestion(suggestion)}
                    >
                      <span
                        className="suggest-dot"
                        style={{ background: token(suggestion.color).hex } as CSSProperties}
                      />
                      <span style={{ minWidth: 0 }}>
                        <span>{suggestion.name}</span>
                        <small>{suggestion.description}</small>
                      </span>
                      <span className="suggest-category">{suggestion.category}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="field">
              <label htmlFor="habit-description">Описание</label>
              <textarea
                id="habit-description"
                className="textarea"
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                placeholder="Что делать"
              />
              <button
                className="link-btn"
                style={{ marginTop: 8 }}
                onClick={() => void askForDescription()}
              >
                {thinking ? "Подбор..." : "Подобрать по смыслу"}
              </button>
            </div>

            <div className="field">
              <label>Расписание</label>
              <div className="segmented">
                {SCHEDULES.map((schedule) => (
                  <button
                    key={schedule.id}
                    type="button"
                    className={form.schedule_type === schedule.id ? "active" : ""}
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        schedule_type: schedule.id,
                        weekdays:
                          schedule.id === "weekdays"
                            ? [1, 2, 3, 4, 5]
                            : schedule.id === "weekends"
                              ? [6, 7]
                              : schedule.id === "daily"
                                ? [1, 2, 3, 4, 5, 6, 7]
                                : current.weekdays.length
                                  ? current.weekdays
                                  : [1],
                      }))
                    }
                  >
                    {schedule.label}
                  </button>
                ))}
              </div>
              {form.schedule_type === "custom" && (
                <div className="weekday-picker">
                  {WEEK_LABELS.map((label, index) => {
                    const day = index + 1;
                    return (
                      <button
                        key={label}
                        type="button"
                        className={form.weekdays.includes(day) ? "active" : ""}
                        onClick={() => toggleWeekday(day)}
                        aria-label={label}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="field-row">
              <div className="field">
                <label htmlFor="habit-category">Категория</label>
                <input
                  id="habit-category"
                  className="input"
                  value={form.category}
                  onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
                  placeholder="Здоровье, Развитие"
                />
              </div>
              <div className="field">
                <label>Цель в неделю</label>
                <div className="stepper">
                  <button onClick={() => setForm((current) => ({ ...current, target_per_week: Math.max(1, current.target_per_week - 1) }))}>−</button>
                  <strong>{form.target_per_week}</strong>
                  <button onClick={() => setForm((current) => ({ ...current, target_per_week: Math.min(7, current.target_per_week + 1) }))}>+</button>
                  <span className="quiet-meta">раз</span>
                </div>
              </div>
            </div>

            <div className="field">
              <label>Иконка</label>
              <div className="picker">
                {QUICK_ICONS.map((name) => {
                  const Icon = getIcon(name);
                  return (
                    <button
                      key={name}
                      type="button"
                      className={`icon-option${form.icon === name ? " active" : ""}`}
                      onClick={() => setForm((current) => ({ ...current, icon: name }))}
                      aria-label={name}
                    >
                      <Icon size={16} strokeWidth={1.5} />
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="field">
              <label>Цвет</label>
              <div className="picker">
                {COLOR_NAMES.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className={`swatch${form.color === name ? " active" : ""}`}
                    style={{ background: token(name).hex } as CSSProperties}
                    onClick={() => setForm((current) => ({ ...current, color: name }))}
                    aria-label={name}
                  />
                ))}
              </div>
            </div>

            {reminder && reminderHabit && (
              <HabitReminderEditor
                habit={reminderHabit}
                value={reminder}
                onChange={setReminder}
                onTest={
                  editingId
                    ? () =>
                        void testReminder(reminder.habit_id).catch((error: Error) =>
                          notify(error.message),
                        )
                    : undefined
                }
              />
            )}

            <div className="dialog-actions">
              <button className="ghost-btn" onClick={closeDialog}>Отмена</button>
              <button className="primary-btn" onClick={submit}>
                <Check size={16} strokeWidth={1.5} /> {editingId ? "Сохранить" : "Создать"}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </>
  );
}
