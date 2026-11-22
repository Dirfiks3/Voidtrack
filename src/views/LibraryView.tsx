import { useMemo, useState, type CSSProperties } from "react";
import { Archive, ArrowDown, ArrowUp, MoreHorizontal, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { getIcon } from "../lib/icons";
import {
  completionRate,
  currentStreak,
  dayWord,
  filterAndSortHabits,
  isChecked,
  scheduleLabel,
} from "../lib/stats";
import { token } from "../lib/theme";
import type { Habit } from "../lib/types";
import { useApp, useCheckinIndex } from "../store";

type Filter = "active" | "archived" | "all";

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "active", label: "Активные" },
  { id: "archived", label: "Архив" },
  { id: "all", label: "Все" },
];

export default function LibraryView() {
  const habits = useApp((state) => state.habits);
  const checkinIndex = useCheckinIndex();
  const todayKey = useApp((state) => state.now.date);
  const query = useApp((state) => state.query.toLowerCase());
  const openDialog = useApp((state) => state.openDialog);
  const deleteHabit = useApp((state) => state.deleteHabit);
  const archiveHabit = useApp((state) => state.archiveHabit);
  const categoryFilter = useApp((state) => state.categoryFilter);
  const setCategoryFilter = useApp((state) => state.setCategoryFilter);
  const sortMode = useApp((state) => state.sortMode);
  const setSortMode = useApp((state) => state.setSortMode);
  const moveHabit = useApp((state) => state.moveHabit);
  const [filter, setFilter] = useState<Filter>("active");
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const scoped = useMemo(
    () => habits.filter(
      (habit) => filter === "all" || (filter === "archived" ? habit.archived : !habit.archived),
    ),
    [habits, filter],
  );
  const categories = useMemo(
    () => [...new Set(habits.map((habit) => habit.category))].sort((a, b) =>
      a.localeCompare(b, "ru"),
    ),
    [habits],
  );
  const visible = useMemo(
    () => filterAndSortHabits(scoped, checkinIndex, {
      query,
      category: categoryFilter,
      sort: sortMode,
    }),
    [scoped, checkinIndex, query, categoryFilter, sortMode],
  );

  // Показатели и иконки готовятся один раз на список, а не на каждый рендер.
  const rows = useMemo(
    () => visible.map((habit: Habit) => ({
      habit,
      Icon: getIcon(habit.icon),
      rate: completionRate(checkinIndex, habit),
      streak: currentStreak(checkinIndex, habit),
      todayDone: isChecked(checkinIndex, habit.id, todayKey),
      schedule: scheduleLabel(habit),
      style: {
        "--habit-color": token(habit.color).hex,
        "--habit-rgb": token(habit.color).rgb,
      } as CSSProperties,
    })),
    [visible, checkinIndex, todayKey],
  );

  return (
    <div className="page">
      <div className="greeting">
        <h1>Привычки</h1>
        <p>Редактируйте, архивируйте и возвращайте без потери истории</p>
      </div>

      <div className="section-head" style={{ marginTop: 24 }}>
        <div className="segmented compact">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              className={filter === item.id ? "active" : ""}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <select
          className="select compact"
          value={categoryFilter}
          onChange={(event) => setCategoryFilter(event.target.value)}
          aria-label="Фильтр по категории"
        >
          <option value="all">Все категории</option>
          {categories.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
        <select
          className="select compact"
          value={sortMode}
          onChange={(event) => setSortMode(event.target.value as typeof sortMode)}
          aria-label="Сортировка привычек"
        >
          <option value="manual">Свой порядок</option>
          <option value="name">По названию</option>
          <option value="target">По цели</option>
          <option value="streak">По серии</option>
        </select>
        <span>{visible.length} в списке</span>
      </div>

      <div className="library-grid">
        {rows.map(({ habit, Icon, rate, streak, todayDone, schedule, style }) => (
            <article
              key={habit.id}
              className={`glass library-item${habit.archived ? " archived" : ""}`}
              style={style}
            >
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                <div className="habit-icon"><Icon size={18} strokeWidth={1.5} /></div>
                <div className="item-menu-wrap">
                  <button
                    className="more-btn"
                    onClick={() => setMenuFor((current) => (current === habit.id ? null : habit.id))}
                    aria-label="Меню привычки"
                  >
                    <MoreHorizontal size={16} strokeWidth={1.5} />
                  </button>
                  {menuFor === habit.id && (
                    <>
                      <div className="menu-scrim" onClick={() => setMenuFor(null)} />
                      <div className="menu-pop">
                        <button
                          onClick={() => {
                            setMenuFor(null);
                            void moveHabit(habit.id, -1);
                          }}
                        >
                          <ArrowUp size={14} strokeWidth={1.5} /> Выше
                        </button>
                        <button
                          onClick={() => {
                            setMenuFor(null);
                            void moveHabit(habit.id, 1);
                          }}
                        >
                          <ArrowDown size={14} strokeWidth={1.5} /> Ниже
                        </button>
                        <button
                          onClick={() => {
                            setMenuFor(null);
                            openDialog(habit.id);
                          }}
                        >
                          <Pencil size={14} strokeWidth={1.5} /> Редактировать
                        </button>
                        <button
                          onClick={() => {
                            setMenuFor(null);
                            void archiveHabit(habit.id, !habit.archived);
                          }}
                        >
                          {habit.archived ? (
                            <RotateCcw size={14} strokeWidth={1.5} />
                          ) : (
                            <Archive size={14} strokeWidth={1.5} />
                          )}
                          {habit.archived ? "Восстановить" : "В архив"}
                        </button>
                        <button
                          className="danger"
                          onClick={() => {
                            setMenuFor(null);
                            void deleteHabit(habit.id);
                          }}
                        >
                          <Trash2 size={14} strokeWidth={1.5} /> Удалить
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
              <div>
                <div className="habit-name" style={{ whiteSpace: "normal" }}>{habit.name}</div>
                <div className="habit-desc" style={{ marginTop: 4 }}>{habit.description}</div>
              </div>
              <div className="habit-meta">
                <span className="habit-dot" />
                <span className="chip">{habit.category}</span>
                <span className="chip chip-quiet">{schedule}</span>
                <span className="streak">
                  {streak} {dayWord(streak)}
                </span>
                {todayDone && !habit.archived && <span className="quiet-meta">сегодня</span>}
                {habit.archived && <span className="chip chip-quiet">архив</span>}
              </div>
              <div className="progress-track" style={{ height: 5 }}>
                <div className="progress-fill" style={{ width: `${rate}%` }} />
              </div>
              <div className="quiet-meta">
                {rate}% за 30 дней · {habit.target_per_week} раз в неделю
              </div>
            </article>
          ))}
        <button className="glass add-tile" onClick={() => openDialog()}>
          <Plus size={20} strokeWidth={1.5} />
          Добавить привычку
        </button>
      </div>
    </div>
  );
}
