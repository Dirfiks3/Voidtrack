import { lazy, Suspense, useMemo } from "react";
import { addDays, format, startOfWeek } from "date-fns";
import { ru } from "date-fns/locale";
import { Flame, Plus, TrendingUp } from "lucide-react";
import { dateKey } from "../lib/api";
import {
  daySummaries,
  dayWord,
  filterAndSortHabits,
  isChecked,
  overallStats,
  scheduledHabits,
  weekDays,
  WEEK_LABELS,
} from "../lib/stats";
import { accentFor } from "../lib/theme";
import { useApp, useCheckinIndex } from "../store";
import HabitCard from "../components/HabitCard";
import ProgressRing from "../components/ProgressRing";
import StaticWeek from "../components/StaticWeek";
import { SectionHead, StatCard } from "../components/Bits";

// three.js и WebGL загружаются только когда объём недели включён.
const WeekObject = lazy(() => import("../components/WeekObject"));

export default function TodayView() {
  const habits = useApp((state) => state.habits);
  const checkinIndex = useCheckinIndex();
  const todayKey = useApp((state) => state.now.date);
  const query = useApp((state) => state.query.toLowerCase());
  const openDialog = useApp((state) => state.openDialog);
  const settings = useApp((state) => state.settings);
  const effectsEnabled = useApp((state) => state.effectsEnabled);
  const pulse = useApp((state) => state.pulse);
  const showAll = useApp((state) => state.showAll);
  const setShowAll = useApp((state) => state.setShowAll);
  const categoryFilter = useApp((state) => state.categoryFilter);
  const setCategoryFilter = useApp((state) => state.setCategoryFilter);
  const sortMode = useApp((state) => state.sortMode);
  const setSortMode = useApp((state) => state.setSortMode);

  // Дата берётся из стора: нажатие клавиши в поиске не пересчитывает календарь.
  const today = useMemo(() => new Date(`${todayKey}T00:00:00`), [todayKey]);
  const accent = accentFor(settings).hex;
  const stats = useMemo(
    () => overallStats(habits, checkinIndex, today),
    [habits, checkinIndex, today],
  );
  const percent = stats.todayTotal ? Math.round((stats.todayDone / stats.todayTotal) * 100) : 0;
  const remaining = Math.max(0, stats.todayTotal - stats.todayDone);

  const active = useMemo(() => habits.filter((habit) => !habit.archived), [habits]);
  const planned = useMemo(() => scheduledHabits(active, today), [active, today]);
  const source = showAll ? active : planned;
  const categories = useMemo(
    () => [...new Set(active.map((habit) => habit.category))].sort((a, b) =>
      a.localeCompare(b, "ru"),
    ),
    [active],
  );
  const visible = useMemo(
    () =>
      filterAndSortHabits(source, checkinIndex, {
        query,
        category: categoryFilter,
        sort: sortMode,
        today,
      }),
    [source, checkinIndex, query, categoryFilter, sortMode, today],
  );

  const week = useMemo(
    () =>
      weekDays(today).map((day) =>
        scheduledHabits(active, day).some((habit) =>
          isChecked(checkinIndex, habit.id, dateKey(day)),
        ),
      ),
    [active, checkinIndex, today],
  );
  const todayIndex = (today.getDay() + 6) % 7;

  // 91 подпись и уровень тепловой карты считаются один раз, а не на каждый рендер.
  const heatCells = useMemo(() => {
    const gridStart = addDays(startOfWeek(today, { weekStartsOn: 1 }), -77);
    const summaries = new Map(
      daySummaries(habits, checkinIndex, 91, addDays(gridStart, 90)).map((day) => [day.date, day]),
    );
    return Array.from({ length: 91 }, (_, index) => {
      const day = addDays(gridStart, index);
      const key = dateKey(day);
      const percentDay = summaries.get(key)?.percent ?? 0;
      const level =
        percentDay === 0 ? 0 : percentDay <= 25 ? 1 : percentDay <= 50 ? 2 : percentDay <= 75 ? 3 : 4;
      return { key, level, title: `${format(day, "d MMMM", { locale: ru })} — ${percentDay}%` };
    });
  }, [habits, checkinIndex, today]);

  const effects = effectsEnabled;

  return (
    <div className="page">
      <div className="greeting">
        <h1>Сегодня</h1>
        <p>
          {stats.todayDone} из {stats.todayTotal} запланировано
          {showAll ? " · показан весь список" : ""}
        </p>
      </div>

      <div className="hero-grid">
        <section className="glass glass-moment week-stage">
          <div className="stage-head">
            <span className="kicker">Неделя в объёме</span>
            <span className="quiet-meta">
              {stats.bestStreak} {dayWord(stats.bestStreak)}
            </span>
          </div>

          {effects ? (
            <Suspense fallback={<StaticWeek week={week} todayIndex={todayIndex} />}>
              <WeekObject
                week={week}
                todayIndex={todayIndex}
                accent={accent}
                pulse={pulse}
              />
            </Suspense>
          ) : (
            <StaticWeek week={week} todayIndex={todayIndex} />
          )}

          <div className="stage-foot">
            <div className="stage-track">
              <div className="stage-week">
                {WEEK_LABELS.map((label) => <span key={label}>{label}</span>)}
              </div>
            </div>
          </div>
        </section>

        <div className="progress-panel">
          <div className="glass glass-moment progress-card">
            <div className="orb-wrap">
              <ProgressRing percent={percent} />
              <div className="orb-value">
                <strong>{percent}%</strong>
                <span>сегодня</span>
              </div>
            </div>
            <div className="progress-copy">
              <div className="kicker">Прогресс</div>
              <h3>{stats.todayDone} из {stats.todayTotal}</h3>
              <p>{remaining === 0 ? "Все отметки есть" : `${remaining} осталось`}</p>
              <div className="progress-pills">
                <span className="quiet-meta">Серия · {stats.bestStreak} {dayWord(stats.bestStreak)}</span>
                <span className="quiet-meta">30 дней · {stats.average}%</span>
              </div>
            </div>
          </div>

          <div className="stat-stack">
            <StatCard
              icon={Flame}
              value={`${stats.bestStreak} ${dayWord(stats.bestStreak)}`}
              label="Лучшая серия"
            />
            <StatCard icon={TrendingUp} value={`${stats.average}%`} label="за 30 дней" />
          </div>
        </div>
      </div>

      <SectionHead
        title="Привычки"
        hint={`${visible.length} в списке · ${planned.length} на сегодня`}
        action={
          <div className="head-actions">
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
            <label className="switch-label">
              <input
                type="checkbox"
                checked={showAll}
                onChange={(event) => setShowAll(event.target.checked)}
              />
              <span className="switch" />
              Показать все
            </label>
            <button className="link-btn" onClick={() => openDialog()}>Создать</button>
          </div>
        }
      />

      {visible.length > 0 ? (
        <div className="habit-list">
          {visible.map((habit) => (
            <HabitCard key={habit.id} habit={habit} date={todayKey} />
          ))}
        </div>
      ) : (
        <div className="glass empty">
          <strong>Нет привычек</strong>
          {query ? "Измените запрос" : "На сегодня ничего не запланировано — включите «Показать все»"}
          <div style={{ marginTop: 16 }}>
            <button className="primary-btn" onClick={() => openDialog()}>
              <Plus size={16} strokeWidth={1.5} /> Создать привычку
            </button>
          </div>
        </div>
      )}

      <SectionHead title="Активность" hint="13 недель · 12×12" />
      <div className="glass heatmap-card">
        <div className="heatmap">
          {heatCells.map((cell) => (
            <div key={cell.key} className="heat-cell" data-level={cell.level} title={cell.title} />
          ))}
        </div>
        <div className="heat-legend">
          0%
          {[0, 1, 2, 3, 4].map((level) => (
            <i
              key={level}
              style={{
                background: level === 0 ? "var(--surface-1)" : `rgba(var(--accent-rgb), ${level * 0.2})`,
              }}
            />
          ))}
          100%
        </div>
      </div>
    </div>
  );
}
