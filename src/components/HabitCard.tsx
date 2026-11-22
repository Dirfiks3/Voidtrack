import { memo, useMemo, useState, type CSSProperties } from "react";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Check,
  FileText,
  Flame,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { dateKey } from "../lib/api";
import { getIcon } from "../lib/icons";
import {
  checkinAt,
  currentStreak,
  dayWord,
  isChecked,
  isScheduled,
  scheduleLabel,
  weekDays,
  weeklyProgress,
} from "../lib/stats";
import { token } from "../lib/theme";
import type { Habit } from "../lib/types";
import { useApp, useCheckinIndex } from "../store";
import HabitHistory from "./HabitHistory";

const HabitCard = memo(function HabitCard({ habit, date }: { habit: Habit; date?: string }) {
  // Карточка подписана только на индекс: переключение отметки — O(1) поиск,
  // а поиск/фильтры в родителе не перерисовывают неизменённые карточки.
  const checkinIndex = useCheckinIndex();
  const toggleCheckin = useApp((state) => state.toggleCheckin);
  const openDialog = useApp((state) => state.openDialog);
  const deleteHabit = useApp((state) => state.deleteHabit);
  const archiveHabit = useApp((state) => state.archiveHabit);
  const setCheckinNote = useApp((state) => state.setCheckinNote);
  const moveHabit = useApp((state) => state.moveHabit);
  const [menuOpen, setMenuOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState<string | null>(null);

  const targetDate = date ?? dateKey(new Date());
  const target = useMemo(() => new Date(`${targetDate}T00:00:00`), [targetDate]);
  const Icon = getIcon(habit.icon);
  const style = useMemo(
    () => ({
      "--habit-color": token(habit.color).hex,
      "--habit-rgb": token(habit.color).rgb,
    }) as CSSProperties,
    [habit.color],
  );

  // Подписи дней не меняются при переключении отметок.
  const dayLabels = useMemo(
    () =>
      weekDays(target).map((day) => ({
        key: dateKey(day),
        title: format(day, "d MMMM", { locale: ru }),
        label: format(day, "EEEEEE", { locale: ru }),
        planned: isScheduled(habit, day),
      })),
    [target, habit],
  );

  const info = useMemo(
    () => ({
      done: isChecked(checkinIndex, habit.id, targetDate),
      note: checkinAt(checkinIndex, habit.id, targetDate)?.note ?? "",
      goal: weeklyProgress(checkinIndex, habit, target),
      streak: currentStreak(checkinIndex, habit, target),
      week: dayLabels.map((day) => ({
        ...day,
        checked: isChecked(checkinIndex, habit.id, day.key),
        isTarget: day.key === targetDate,
      })),
    }),
    [checkinIndex, habit, targetDate, target, dayLabels],
  );

  const { done, goal, streak } = info;
  const note = noteDraft ?? info.note;

  return (
    <article className="glass habit-card" style={style}>
      <div className="habit-top">
        <div className="habit-icon">
          <Icon size={18} strokeWidth={1.5} />
        </div>
        <div className="habit-info">
          <div className="habit-name">{habit.name}</div>
          <div className="habit-desc">{habit.description}</div>
          <div className="habit-meta">
            <span className="habit-dot" />
            <span className="chip">{habit.category}</span>
            <span className="chip chip-quiet">{scheduleLabel(habit)}</span>
            {streak > 0 && (
              <span className="streak">
                <Flame size={14} strokeWidth={1.5} /> {streak} {dayWord(streak)}
              </span>
            )}
            <span className={`chip chip-quiet${goal.complete ? " goal-done" : ""}`}>
              Цель · {goal.done}/{goal.target}
            </span>
          </div>
        </div>
        <button className="more-btn" onClick={() => setMenuOpen((value) => !value)} aria-label="Меню привычки">
          <MoreHorizontal size={16} strokeWidth={1.5} />
        </button>
      </div>

      <div className="habit-bottom">
        <div className="week-dots">
          {info.week.map((day) => (
            <div
              key={day.key}
              title={`${day.title}${day.planned ? "" : " — не запланировано"}`}
              className={[
                "week-dot",
                day.checked ? "done" : "",
                day.isTarget ? "today" : "",
                day.planned ? "" : "off",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {day.label}
            </div>
          ))}
        </div>
        <button
          onClick={() => void toggleCheckin(habit.id, targetDate)}
          className={`check-btn${done ? " checked" : ""}`}
          aria-label={done ? "Снять отметку" : "Отметить выполненной"}
        >
          <Check size={18} strokeWidth={1.75} />
        </button>
      </div>

      <div className="habit-extra">
        <div className="goal-track" title={`Цель недели: ${goal.done} из ${goal.target}`}>
          <div style={{ width: `${goal.percent}%` }} />
        </div>
        <div className="habit-tools">
          <button
            className="ghost-btn tiny"
            onClick={() => setHistoryOpen(true)}
            title="История и заметки"
          >
            <FileText size={13} strokeWidth={1.5} /> История
          </button>
          {done && (
            <button
              className="ghost-btn tiny"
              onClick={() => setNoteOpen((value) => !value)}
              title="Заметка к отметке"
            >
              {note ? "Заметка · есть" : "Заметка"}
            </button>
          )}
        </div>
        {noteOpen && done && (
          <textarea
            className="textarea note-input"
            rows={2}
            value={note}
            onChange={(event) => setNoteDraft(event.target.value)}
            onBlur={() => {
              if (noteDraft === null) return;
              void setCheckinNote(habit.id, targetDate, noteDraft);
              setNoteDraft(null);
            }}
            placeholder="Что сегодня было?"
          />
        )}
      </div>

      {menuOpen && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 25 }} onClick={() => setMenuOpen(false)} />
          <div className="menu-pop">
            <button
              onClick={() => {
                setMenuOpen(false);
                void moveHabit(habit.id, -1);
              }}
            >
              <ArrowUp size={14} strokeWidth={1.5} /> Выше
            </button>
            <button
              onClick={() => {
                setMenuOpen(false);
                void moveHabit(habit.id, 1);
              }}
            >
              <ArrowDown size={14} strokeWidth={1.5} /> Ниже
            </button>
            <button
              onClick={() => {
                setMenuOpen(false);
                openDialog(habit.id);
              }}
            >
              <Pencil size={14} strokeWidth={1.5} /> Редактировать
            </button>
            <button
              onClick={() => {
                setMenuOpen(false);
                void archiveHabit(habit.id, !habit.archived);
              }}
            >
              <Archive size={14} strokeWidth={1.5} />
              {habit.archived ? "Восстановить" : "В архив"}
            </button>
            <button
              className="danger"
              onClick={() => {
                setMenuOpen(false);
                void deleteHabit(habit.id);
              }}
            >
              <Trash2 size={14} strokeWidth={1.5} /> Удалить
            </button>
          </div>
        </>
      )}

      {historyOpen && <HabitHistory habit={habit} onClose={() => setHistoryOpen(false)} />}
    </article>
  );
});

export default HabitCard;
