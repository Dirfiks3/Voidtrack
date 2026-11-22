import { useMemo, useState } from "react";
import { Award, CheckCheck, Flame, Layers3, Lock, Trophy } from "lucide-react";
import {
  achievements,
  completionRate,
  currentStreak,
  daySummaries,
  dayWord,
  longestStreak,
  overallStats,
} from "../lib/stats";
import { getIcon } from "../lib/icons";
import { useApp, useCheckinIndex } from "../store";
import { SectionHead, StatCard } from "../components/Bits";

const RANGES = [7, 30, 90] as const;

export default function StatsView() {
  const habits = useApp((state) => state.habits);
  const checkinIndex = useCheckinIndex();
  const nowDate = useApp((state) => state.now.date);
  const [range, setRange] = useState<(typeof RANGES)[number]>(30);

  const today = useMemo(() => new Date(`${nowDate}T00:00:00`), [nowDate]);
  const stats = useMemo(
    () => overallStats(habits, checkinIndex, today),
    [habits, checkinIndex, today],
  );
  const days = useMemo(
    () => daySummaries(habits, checkinIndex, range, today),
    [habits, checkinIndex, range, today],
  );
  const active = useMemo(() => habits.filter((habit) => !habit.archived), [habits]);
  const bestDay = useMemo(
    () => days.reduce(
      (best, day) => (day.percent > best.percent ? day : best),
      days[0] ?? { label: "—", percent: 0 },
    ),
    [days],
  );

  // Все показатели по привычкам — один проход, а не три вызова на строку.
  const rows = useMemo(
    () =>
      active.map((habit) => ({
        habit,
        rate: completionRate(checkinIndex, habit, range, today),
        streak: currentStreak(checkinIndex, habit, today),
        best: longestStreak(checkinIndex, habit, today),
      })),
    [active, checkinIndex, range, today],
  );

  // Достижения считаются один раз и переиспользуют уже готовое среднее.
  const badges = useMemo(
    () => achievements(habits, checkinIndex, stats.average),
    [habits, checkinIndex, stats.average],
  );
  const unlocked = badges.filter((item) => item.unlocked).length;

  return (
    <div className="page">
      <div className="greeting">
        <h1>Статистика</h1>
        <p>Честные показатели с учётом расписания</p>
      </div>

      <div className="section-head" style={{ marginTop: 24, marginBottom: 0 }}>
        <div className="segmented compact">
          {RANGES.map((value) => (
            <button
              key={value}
              className={range === value ? "active" : ""}
              onClick={() => setRange(value)}
            >
              {value} дней
            </button>
          ))}
        </div>
        <span className="quiet-meta">Лучший день · {bestDay.label} · {bestDay.percent}%</span>
      </div>

      <div className="stats-grid">
        <StatCard icon={Layers3} value={stats.totalHabits} label="Привычек" />
        <StatCard icon={CheckCheck} value={stats.totalCheckins} label="Отметок" />
        <StatCard icon={Award} value={`${stats.average}%`} label="Среднее за 30 дней" />
        <StatCard
          icon={Flame}
          value={`${stats.bestStreak} ${dayWord(stats.bestStreak)}`}
          label="Текущая серия"
        />
      </div>

      <div className="glass chart-card">
        <SectionHead title="Выполнения" hint={`${range} дней`} />
        <div className="chart-bars" data-range={range}>
          {days.map((day) => (
            <div
              key={day.date}
              className="chart-bar"
              title={`${day.label} — ${day.done}/${day.total} · ${day.percent}%`}
              style={{ height: `${Math.max(2, day.percent)}%` }}
            />
          ))}
        </div>
        <div className="chart-axis">
          <span>{days[0]?.label}</span>
          <span>сегодня</span>
        </div>
      </div>

      <SectionHead title="По привычкам" hint={`${range} дней`} />
      <div className="glass chart-card">
        {rows.map(({ habit, rate, streak, best }) => {
          const Icon = getIcon(habit.icon);
          return (
            <div className="progress-row" key={habit.id}>
              <div className="habit-icon" style={{ width: 34, height: 34, flexBasis: 34, borderRadius: 10 }}>
                <Icon size={16} strokeWidth={1.5} />
              </div>
              <div style={{ minWidth: 150 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{habit.name}</div>
                <div className="quiet-meta">
                  Серия {streak} {dayWord(streak)} · рекорд {best} {dayWord(best)}
                </div>
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${rate}%` }} />
              </div>
              <strong className="quiet-meta" style={{ minWidth: 40, textAlign: "right" }}>{rate}%</strong>
            </div>
          );
        })}
        {active.length === 0 && <div className="empty">Пока нет активных привычек</div>}
      </div>

      <SectionHead title="Достижения" hint={`${unlocked} открыто`} />
      <div className="achievement-grid">
        {badges.map((badge) => (
          <div
            key={badge.id}
            className={`glass achievement${badge.unlocked ? " unlocked" : ""}`}
          >
            <div className="achievement-icon">
              {badge.unlocked ? <Trophy size={17} strokeWidth={1.5} /> : <Lock size={15} strokeWidth={1.5} />}
            </div>
            <div>
              <strong>{badge.title}</strong>
              <span className="quiet-meta">{badge.description}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
