import { useState } from "react";
import { BellRing, Layers3, Plus, Search, SlidersHorizontal, X } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { useReminders } from "../features/reminders/store";
import { useApp } from "../store";

export default function TopBar() {
  const query = useApp((state) => state.query);
  const setQuery = useApp((state) => state.setQuery);
  const openDialog = useApp((state) => state.openDialog);
  const effectsEnabled = useApp((state) => state.effectsEnabled);
  const toggleEffects = useApp((state) => state.toggleEffects);
  const setCustomizeOpen = useApp((state) => state.setCustomizeOpen);
  const now = useApp((state) => state.now);
  const remindersEnabled = useReminders((state) => state.settings.enabled);
  const loadReminders = useReminders((state) => state.load);
  const [searchOpen, setSearchOpen] = useState(false);

  const fallback = format(new Date(), "d MMMM, EEEE", { locale: ru });
  const todayLabel = now.label || fallback;

  return (
    <header className={`topbar${searchOpen ? " searching" : ""}`}>
      <div>
        <div className="topbar-title">{todayLabel}</div>
        <div className="topbar-sub">
          {now.time ? `${now.time} · локально` : "локально"}
        </div>
      </div>
      <div className="topbar-spacer" />
      <button
        className="icon-btn mobile-search-btn"
        onClick={() => setSearchOpen((open) => !open)}
        title={searchOpen ? "Закрыть поиск" : "Поиск"}
        aria-label={searchOpen ? "Закрыть поиск" : "Поиск привычек"}
      >
        {searchOpen ? <X size={16} strokeWidth={1.5} /> : <Search size={16} strokeWidth={1.5} />}
      </button>
      <label className="search">
        <Search size={16} strokeWidth={1.5} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Поиск"
          aria-label="Поиск привычек"
        />
      </label>
      <button
        className={`icon-btn${effectsEnabled ? " on" : ""}`}
        onClick={toggleEffects}
        title={effectsEnabled ? "Выключить 3D-эффекты" : "Включить 3D-эффекты"}
        aria-label={effectsEnabled ? "Выключить 3D-эффекты" : "Включить 3D-эффекты"}
      >
        <Layers3 size={16} strokeWidth={1.5} />
      </button>
      <button
        className={`icon-btn${remindersEnabled ? " on" : ""}`}
        onClick={() => {
          void loadReminders();
          setCustomizeOpen(true, "reminders");
        }}
        title="Напоминания"
        aria-label="Напоминания"
      >
        <BellRing size={16} strokeWidth={1.5} />
      </button>
      <button
        className="icon-btn"
        onClick={() => setCustomizeOpen(true, "appearance")}
        title="Внешний вид"
        aria-label="Внешний вид"
      >
        <SlidersHorizontal size={16} strokeWidth={1.5} />
      </button>
      <button className="primary-btn" onClick={() => openDialog()}>
        <Plus size={16} strokeWidth={1.5} /> Новая привычка
      </button>
    </header>
  );
}
