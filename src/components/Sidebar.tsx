import { BarChart3, CalendarDays, LayoutDashboard, Library, ShieldCheck } from "lucide-react";
import type { ViewId } from "../lib/types";
import { useApp } from "../store";

const NAV: Array<{ id: ViewId; label: string; icon: typeof LayoutDashboard }> = [
  { id: "today", label: "Сегодня", icon: LayoutDashboard },
  { id: "calendar", label: "Календарь", icon: CalendarDays },
  { id: "stats", label: "Статистика", icon: BarChart3 },
  { id: "library", label: "Привычки", icon: Library },
];

export default function Sidebar() {
  const view = useApp((state) => state.view);
  const setView = useApp((state) => state.setView);
  const habits = useApp((state) => state.habits);

  return (
    <aside className="glass sidebar">
      <div className="brand">
        <div className="brand-mark"><img src="/icon.png" alt="" aria-hidden="true" /></div>
        <div>
          <div className="brand-name">VoidTrack</div>
          <div className="brand-sub">локально</div>
        </div>
      </div>

      <div className="nav-label">Разделы</div>
      <nav>
        {NAV.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={`nav-item${view === id ? " active" : ""}`}
            onClick={() => setView(id)}
          >
            <span className="nav-icon">
              <Icon size={16} strokeWidth={1.5} />
            </span>
            <span className="nav-text">{label}</span>
            {id === "library" && <span className="nav-badge">{habits.filter((habit) => !habit.archived).length}</span>}
          </button>
        ))}
      </nav>

      <div className="sidebar-spacer" />
      <div className="privacy-card">
        <h4>
          <ShieldCheck size={16} strokeWidth={1.5} /> Локально
        </h4>
        <p>Без аккаунта и сервера.</p>
      </div>
      <div className="sidebar-version">v0.1</div>
    </aside>
  );
}
