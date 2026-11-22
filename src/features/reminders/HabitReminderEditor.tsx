import { BellRing, Clock3, FlaskConical } from "lucide-react";
import { WEEK_LABELS } from "../../lib/stats";
import type { Habit, HabitReminder } from "../../lib/types";
import { formatInterval, INTERVAL_PRESETS } from "./defaults";

interface Props {
  habit: Habit;
  value: HabitReminder;
  onChange: (next: HabitReminder) => void;
  onTest?: () => void;
}

export default function HabitReminderEditor({ habit, value, onChange, onTest }: Props) {
  const patch = (next: Partial<HabitReminder>) => onChange({ ...value, ...next });

  const toggleDay = (day: number) => {
    const days = value.days.includes(day)
      ? value.days.filter((item) => item !== day)
      : [...value.days, day].sort((a, b) => a - b);
    patch({ days: days.length ? days : [day] });
  };

  const addTime = () => {
    if (value.times.length >= 12) return;
    const last = value.times[value.times.length - 1] ?? "09:00";
    const [hour, minute] = last.split(":").map(Number);
    const total = ((hour || 0) * 60 + (minute || 0) + 60) % 1440;
    const next = `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
    if (!value.times.includes(next)) patch({ times: [...value.times, next].sort() });
  };

  return (
    <div className="reminder-editor">
      <div className="reminder-editor-head">
        <div className="reminder-editor-title">
          <BellRing size={16} strokeWidth={1.5} />
          <span>Напоминания · {habit.name}</span>
        </div>
        <label className="switch-label">
          <input
            type="checkbox"
            checked={value.enabled}
            onChange={(event) => patch({ enabled: event.target.checked })}
          />
          <span className="switch" />
        </label>
      </div>

      <div className={value.enabled ? "reminder-editor-body" : "reminder-editor-body disabled"}>
        <div className="field">
          <label>Как напоминать</label>
          <div className="segmented">
            <button
              type="button"
              className={value.mode === "interval" ? "active" : ""}
              onClick={() => patch({ mode: "interval" })}
            >
              Каждые N минут
            </button>
            <button
              type="button"
              className={value.mode === "times" ? "active" : ""}
              onClick={() => patch({ mode: "times" })}
            >
              В нужное время
            </button>
          </div>
        </div>

        {value.mode === "interval" ? (
          <div className="field">
            <label>Интервал</label>
            <div className="interval-row">
              <div className="stepper">
                <button
                  type="button"
                  onClick={() => patch({ interval_minutes: Math.max(30, value.interval_minutes - 15) })}
                >
                  −
                </button>
                <strong>{formatInterval(value.interval_minutes)}</strong>
                <button
                  type="button"
                  onClick={() => patch({ interval_minutes: Math.min(1440, value.interval_minutes + 15) })}
                >
                  +
                </button>
              </div>
              <input
                className="input interval-input"
                type="number"
                min={30}
                max={1440}
                step={15}
                value={value.interval_minutes}
                onChange={(event) => patch({ interval_minutes: Number(event.target.value) || 30 })}
                aria-label="Интервал в минутах"
              />
              <span className="quiet-meta">мин</span>
            </div>
            <div className="preset-row">
              {INTERVAL_PRESETS.map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  className={value.interval_minutes === minutes ? "active" : ""}
                  onClick={() => patch({ interval_minutes: minutes })}
                >
                  {formatInterval(minutes)}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="field">
            <label>Время напоминаний</label>
            <div className="time-list">
              {value.times.map((time, index) => (
                <div className="time-chip" key={`${time}-${index}`}>
                  <Clock3 size={13} strokeWidth={1.5} />
                  <input
                    type="time"
                    value={time}
                    onChange={(event) => {
                      const times = [...value.times];
                      times[index] = event.target.value;
                      patch({ times: Array.from(new Set(times)).sort() });
                    }}
                    aria-label={`Время ${index + 1}`}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      patch({ times: value.times.filter((_, position) => position !== index) })
                    }
                    aria-label="Удалить время"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button type="button" className="ghost-btn small" onClick={addTime}>
                + Добавить время
              </button>
            </div>
          </div>
        )}

        <div className="field">
          <label>Дни недели</label>
          <div className="weekday-picker">
            {WEEK_LABELS.map((label, index) => {
              const day = index + 1;
              return (
                <button
                  key={label}
                  type="button"
                  className={value.days.includes(day) ? "active" : ""}
                  onClick={() => toggleDay(day)}
                  aria-label={label}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="field">
          <label htmlFor="reminder-title">Заголовок</label>
          <input
            id="reminder-title"
            className="input"
            value={value.title}
            onChange={(event) => patch({ title: event.target.value })}
            placeholder="{habit} — пора"
          />
          <small className="field-hint">Переменные: {'{habit}'}, {'{description}'}, {'{category}'}, {'{target}'}</small>
        </div>

        <div className="field">
          <label htmlFor="reminder-body">Текст</label>
          <textarea
            id="reminder-body"
            className="textarea"
            rows={2}
            value={value.body}
            onChange={(event) => patch({ body: event.target.value })}
            placeholder="Напоминание: {habit}"
          />
        </div>

        <label className="check-row">
          <input
            type="checkbox"
            checked={value.skip_if_done}
            onChange={(event) => patch({ skip_if_done: event.target.checked })}
          />
          <span>Не беспокоить, если сегодня уже выполнено</span>
        </label>

        {onTest && (
          <button type="button" className="ghost-btn small" onClick={onTest}>
            <FlaskConical size={13} strokeWidth={1.5} /> Проверить уведомление
          </button>
        )}
      </div>
    </div>
  );
}
