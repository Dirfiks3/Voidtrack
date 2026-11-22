import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { lastDays } from "../lib/stats";
import type { Habit } from "../lib/types";
import { useApp } from "../store";

export default function HabitHistory({
  habit,
  onClose,
}: {
  habit: Habit;
  onClose: () => void;
}) {
  const checkins = useApp((state) => state.checkins);
  const setCheckinNote = useApp((state) => state.setCheckinNote);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const rows = useMemo(() => {
    const dates = new Map(checkins.filter((item) => item.habit_id === habit.id).map((item) => [item.date, item]));
    return lastDays(30)
      .map((day) => dates.get(`${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`))
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .reverse();
  }, [checkins, habit.id]);

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="glass dialog history-dialog">
        <div className="history-head">
          <div>
            <h2>История · {habit.name}</h2>
            <p className="dialog-sub">Заметки к отметкам за последние 30 дней</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
        <div className="history-list">
          {rows.length === 0 && <div className="empty">Отметок пока нет</div>}
          {rows.map((checkin) => {
            const date = new Date(`${checkin.date}T00:00:00`);
            return (
              <div className="history-row" key={checkin.id}>
                <div className="history-date">
                  <strong>{format(date, "d MMM", { locale: ru })}</strong>
                  <span className="quiet-meta">{format(date, "EEEE", { locale: ru })}</span>
                </div>
                <textarea
                  className="textarea history-note"
                  rows={2}
                  value={drafts[checkin.id] ?? checkin.note ?? ""}
                  onChange={(event) =>
                    setDrafts((current) => ({ ...current, [checkin.id]: event.target.value }))
                  }
                  onBlur={() => {
                    const value = drafts[checkin.id] ?? checkin.note ?? "";
                    if (value !== (checkin.note ?? "")) void setCheckinNote(habit.id, checkin.date, value);
                  }}
                  placeholder="Заметка..."
                />
              </div>
            );
          })}
        </div>
        <div className="dialog-actions">
          <button className="primary-btn" onClick={onClose}>Готово</button>
        </div>
      </div>
    </div>
  );
}
