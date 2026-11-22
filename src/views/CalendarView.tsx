import { useMemo, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ru } from "date-fns/locale";
import { CalendarCheck, ChevronLeft, ChevronRight } from "lucide-react";
import { dateKey } from "../lib/api";
import { isChecked, isScheduled, scheduledHabits } from "../lib/stats";
import { useApp, useCheckinIndex } from "../store";
import HabitCard from "../components/HabitCard";
import { SectionHead } from "../components/Bits";

export default function CalendarView() {
  const [month, setMonth] = useState(new Date());
  const habits = useApp((state) => state.habits);
  const checkinIndex = useCheckinIndex();
  const nowDate = useApp((state) => state.now.date);
  const selectedDate = useApp((state) => state.selectedDate);
  const setSelectedDate = useApp((state) => state.setSelectedDate);
  const showAll = useApp((state) => state.showAll);
  const setShowAll = useApp((state) => state.setShowAll);

  const active = useMemo(() => habits.filter((habit) => !habit.archived), [habits]);
  const selected = useMemo(() => new Date(`${selectedDate}T00:00:00`), [selectedDate]);
  const days = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }),
        end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }),
      }),
    [month],
  );

  const planned = useMemo(() => scheduledHabits(active, selected), [active, selected]);
  const list = showAll ? active : planned;
  const doneCount = useMemo(
    () => planned.filter((habit) => isChecked(checkinIndex, habit.id, selectedDate)).length,
    [planned, checkinIndex, selectedDate],
  );

  const monthLabel = useMemo(
    () => format(month, "LLLL yyyy", { locale: ru }).replace(/^./, (c) => c.toUpperCase()),
    [month],
  );
  const selectedLabel = useMemo(
    () => format(selected, "d MMMM, EEEE", { locale: ru }),
    [selected],
  );
  const sectionLabel = useMemo(
    () => format(selected, "d MMMM", { locale: ru }),
    [selected],
  );
  // Один проход по 42 ячейкам: отметки ищутся в индексе за O(1), флаги переиспользуются.
  const cells = useMemo(
    () =>
      days.map((day) => {
        const key = dateKey(day);
        const plannedForDay = scheduledHabits(active, day);
        const flags = plannedForDay.map((habit) => isChecked(checkinIndex, habit.id, key));
        const done = flags.reduce((sum, flag) => sum + (flag ? 1 : 0), 0);
        return {
          day,
          key,
          number: format(day, "d"),
          muted: !isSameMonth(day, month),
          selected: key === selectedDate,
          today: isToday(day),
          total: plannedForDay.length,
          done,
          pct: plannedForDay.length ? done / plannedForDay.length : 0,
          title: plannedForDay.length
            ? `${done}/${plannedForDay.length} выполнено`
            : "Нет запланированных привычек",
          dots: plannedForDay.slice(0, 5).map((habit, index) => ({
            id: habit.id,
            done: flags[index],
          })),
        };
      }),
    [days, active, checkinIndex, month, selectedDate, nowDate],
  );
  const scheduledCount = useMemo(
    () => planned.filter((habit) => isScheduled(habit, selected)).length,
    [planned, selected],
  );

  return (
    <div className="page">
      <div className="greeting">
        <h1>Календарь</h1>
        <p>Выберите день, чтобы отметить привычки задним числом</p>
      </div>

      <div className="glass calendar-card" style={{ marginTop: 24 }}>
        <div className="section-head" style={{ margin: "0 0 16px" }}>
          <div className="month-nav">
            <button className="icon-btn" onClick={() => setMonth(addMonths(month, -1))} aria-label="Предыдущий месяц">
              <ChevronLeft size={16} strokeWidth={1.5} />
            </button>
            <strong>{monthLabel}</strong>
            <button className="icon-btn" onClick={() => setMonth(addMonths(month, 1))} aria-label="Следующий месяц">
              <ChevronRight size={16} strokeWidth={1.5} />
            </button>
          </div>
          <div className="calendar-tools">
            <button
              className="ghost-btn"
              onClick={() => {
                const today = new Date();
                setMonth(today);
                setSelectedDate(dateKey(today));
              }}
            >
              <CalendarCheck size={14} strokeWidth={1.5} /> Сегодня
            </button>
            <span className="quiet-meta">
              Выбрано: {selectedLabel}
            </span>
          </div>
        </div>

        <div className="calendar-grid">
          {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((label) => (
            <div key={label} className="calendar-weekday">{label}</div>
          ))}
          {cells.map((cell) => (
            <button
              key={cell.key}
              className={`day-cell${cell.muted ? " muted" : ""}${cell.selected ? " selected" : ""}${cell.today ? " today" : ""}`}
              onClick={() => {
                setSelectedDate(cell.key);
                if (cell.muted) setMonth(cell.day);
              }}
              title={cell.title}
            >
              <span className="day-number">{cell.number}</span>
              <span className="day-dots">
                {cell.dots.map((dot) => (
                  <i key={dot.id} className={dot.done ? "done" : ""} />
                ))}
              </span>
              <span className="day-meter">
                <i style={{ width: `${cell.pct * 100}%` }} />
              </span>
            </button>
          ))}
        </div>
      </div>

      <SectionHead
        title={`Привычки · ${sectionLabel}`}
        hint={`${doneCount}/${planned.length} выполнено · ${list.length} в списке`}
        action={
          <label className="switch-label">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(event) => setShowAll(event.target.checked)}
            />
            <span className="switch" />
            Показать все
          </label>
        }
      />
      <div className="habit-list">
        {list.map((habit) => (
          <HabitCard key={habit.id} habit={habit} date={selectedDate} />
        ))}
      </div>
      {list.length === 0 && (
        <div className="glass empty">На этот день привычек не запланировано</div>
      )}

      {showAll && planned.length > 0 && (
        <p className="quiet-meta" style={{ marginTop: 16 }}>
          Запланировано на этот день: {scheduledCount}
        </p>
      )}
    </div>
  );
}
