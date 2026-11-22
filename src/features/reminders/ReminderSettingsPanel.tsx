import { BellRing, Info, RefreshCw, ShieldAlert } from "lucide-react";
import { useApp } from "../../store";
import { WEEK_LABELS } from "../../lib/stats";
import { formatInterval, INTERVAL_PRESETS } from "./defaults";
import { useReminders } from "./store";

export default function ReminderSettingsPanel() {
  const settings = useReminders((state) => state.settings);
  const status = useReminders((state) => state.status);
  const loading = useReminders((state) => state.loading);
  const reminders = useReminders((state) => state.reminders);
  const load = useReminders((state) => state.load);
  const saveSettings = useReminders((state) => state.saveSettings);
  const requestPermission = useReminders((state) => state.requestPermission);
  const openDialog = useApp((state) => state.openDialog);
  const notify = useApp((state) => state.notify);

  const toggleDay = (day: number) => {
    const days = settings.active_days.includes(day)
      ? settings.active_days.filter((item) => item !== day)
      : [...settings.active_days, day].sort((a, b) => a - b);
    void saveSettings({ active_days: days.length ? days : [day] }).catch((error: Error) =>
      notify(error.message),
    );
  };

  if (loading && !status) {
    return <div className="quiet-meta">Загрузка настроек уведомлений…</div>;
  }

  const activeCount = Object.values(reminders).filter((reminder) => reminder.enabled).length;
  const permission = status?.permission ?? "prompt";

  return (
    <div className="reminder-settings">
      <div className="reminder-status">
        <div className={`permission-dot ${permission}`} />
        <div>
          <strong>
            {permission === "granted"
              ? "Уведомления разрешены"
              : permission === "denied"
                ? "Уведомления запрещены"
                : "Нужно разрешение"}
          </strong>
          <p>
            {status?.platform === "android"
              ? `Нативные напоминания Android · запланировано ${status.scheduled_count}`
              : "Планировщик Rust работает, пока приложение запущено"}
          </p>
        </div>
        {permission !== "granted" && (
          <button
            className="ghost-btn small"
            onClick={() => void requestPermission().catch((error: Error) => notify(error.message))}
          >
            <ShieldAlert size={13} strokeWidth={1.5} /> Разрешить
          </button>
        )}
      </div>

      <label className="check-row prominent">
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(event) =>
            void saveSettings({ enabled: event.target.checked }).catch((error: Error) =>
              notify(error.message),
            )
          }
        />
        <span>
          <strong>Включить напоминания</strong>
          <small>Главный выключатель для всех привычек</small>
        </span>
      </label>

      <section>
        <h3>Интервал по умолчанию</h3>
        <div className="interval-row">
          <div className="stepper">
            <button
              onClick={() =>
                void saveSettings({
                  default_interval_minutes: Math.max(30, settings.default_interval_minutes - 15),
                })
              }
            >
              −
            </button>
            <strong>{formatInterval(settings.default_interval_minutes)}</strong>
            <button
              onClick={() =>
                void saveSettings({
                  default_interval_minutes: Math.min(1440, settings.default_interval_minutes + 15),
                })
              }
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
            value={settings.default_interval_minutes}
            onChange={(event) =>
              void saveSettings({
                default_interval_minutes: Number(event.target.value) || 210,
              })
            }
            aria-label="Интервал по умолчанию в минутах"
          />
          <span className="quiet-meta">мин</span>
        </div>
        <div className="preset-row">
          {INTERVAL_PRESETS.map((minutes) => (
            <button
              key={minutes}
              className={settings.default_interval_minutes === minutes ? "active" : ""}
              onClick={() => void saveSettings({ default_interval_minutes: minutes })}
            >
              {formatInterval(minutes)}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3>Тихие часы</h3>
        <label className="check-row">
          <input
            type="checkbox"
            checked={settings.quiet_hours_enabled}
            onChange={(event) =>
              void saveSettings({ quiet_hours_enabled: event.target.checked })
            }
          />
          <span>Не присылать уведомления ночью</span>
        </label>
        {settings.quiet_hours_enabled && (
          <div className="quiet-range">
            <input
              className="input"
              type="time"
              value={settings.quiet_start}
              onChange={(event) => void saveSettings({ quiet_start: event.target.value })}
              aria-label="Начало тихих часов"
            />
            <span className="quiet-meta">до</span>
            <input
              className="input"
              type="time"
              value={settings.quiet_end}
              onChange={(event) => void saveSettings({ quiet_end: event.target.value })}
              aria-label="Конец тихих часов"
            />
          </div>
        )}
      </section>

      <section>
        <h3>Дни недели</h3>
        <div className="weekday-picker">
          {WEEK_LABELS.map((label, index) => {
            const day = index + 1;
            return (
              <button
                key={label}
                className={settings.active_days.includes(day) ? "active" : ""}
                onClick={() => toggleDay(day)}
                aria-label={label}
              >
                {label}
              </button>
            );
          })}
        </div>
        <small className="field-hint">
          Для новых привычек. У существующих свои дни настраиваются в карточке.
        </small>
      </section>

      <section>
        <h3>Звук и вибрация</h3>
        <label className="check-row">
          <input
            type="checkbox"
            checked={settings.sound_enabled}
            onChange={(event) => void saveSettings({ sound_enabled: event.target.checked })}
          />
          <span>Звук (Android)</span>
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={settings.vibration_enabled}
            onChange={(event) => void saveSettings({ vibration_enabled: event.target.checked })}
          />
          <span>Вибрация (Android)</span>
        </label>
      </section>

      <section>
        <h3>Привычки · {activeCount}</h3>
        <div className="reminder-habit-list">
          {Object.values(reminders).map((reminder) => (
            <button
              key={reminder.habit_id}
              className="reminder-habit-row"
              onClick={() => openDialog(reminder.habit_id)}
            >
              <BellRing size={14} strokeWidth={1.5} />
              <span>{reminder.title}</span>
              <small>
                {reminder.mode === "times"
                  ? reminder.times.join(", ")
                  : formatInterval(reminder.interval_minutes)}
              </small>
            </button>
          ))}
        </div>
        <button
          className="ghost-btn small"
          onClick={() => void load()}
          style={{ marginTop: 10 }}
        >
          <RefreshCw size={13} strokeWidth={1.5} /> Обновить
        </button>
      </section>

      <div className="reminder-note">
        <Info size={14} strokeWidth={1.5} />
        <span>
          Desktop: напоминания приходят, пока VoidTrack запущен. Android: система доставляет их
          даже после закрытия приложения.
        </span>
      </div>
    </div>
  );
}
