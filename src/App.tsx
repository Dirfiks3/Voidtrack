import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2 } from "lucide-react";

import CrashScreen from "./components/CrashScreen";
import CustomizePanel from "./components/CustomizePanel";
import HabitDialog from "./components/HabitDialog";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import { useReminders } from "./features/reminders/store";
import { isTauri } from "./lib/api";
import { currentCrash, subscribeCrash } from "./lib/errorLog";
import { useApp } from "./store";
import CalendarView from "./views/CalendarView";
import LibraryView from "./views/LibraryView";
import StatsView from "./views/StatsView";
import TodayView from "./views/TodayView";

export default function App() {
  const loading = useApp((state) => state.loading);
  const view = useApp((state) => state.view);
  const setView = useApp((state) => state.setView);
  const toast = useApp((state) => state.toast);
  const dialogOpen = useApp((state) => state.dialogOpen);
  const openDialog = useApp((state) => state.openDialog);
  const closeDialog = useApp((state) => state.closeDialog);
  const load = useApp((state) => state.load);
  const [crash, setCrash] = useState(currentCrash());

  useEffect(() => subscribeCrash(() => setCrash(currentCrash())), []);

  useEffect(() => {
    void load();
  }, [load]);

  // На Android разрешение уведомлений нужно запросить при первом запуске,
  // иначе нативные расписания отклоняются системой.
  useEffect(() => {
    void useReminders.getState().load();
  }, []);

  // На Android действие «Отметил» в уведомлении меняет данные в фоне —
  // подхватываем событие и обновляем состояние, когда приложение открыто.
  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void import("@tauri-apps/api/event")
      .then(({ listen }) => {
        if (cancelled) return;
        void listen<string>("reminder-completed", () => {
          void load();
          void useReminders.getState().load();
        }).then((fn) => {
          if (cancelled) fn();
          else unlisten = fn;
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [load]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
      if (event.key === "Escape" && dialogOpen) {
        closeDialog();
        return;
      }
      if (typing || dialogOpen) return;
      if (event.key.toLowerCase() === "n") openDialog();
      if (["1", "2", "3", "4"].includes(event.key)) {
        setView((["today", "calendar", "stats", "library"] as const)[Number(event.key) - 1]);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeDialog, dialogOpen, openDialog, setView]);

  return (
    <div className="app-shell">
      {loading ? (
        <div style={{ display: "grid", placeItems: "center", flex: 1 }}>
          <div className="glass" style={{ padding: "20px 24px", fontSize: 13 }}>
            Загрузка
          </div>
        </div>
      ) : (
        <>
          <Sidebar />
          <main className="main">
            <TopBar />
            <div className="content">
              <motion.div
                key={view}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                style={{ height: "100%" }}
              >
                {view === "today" && <TodayView />}
                {view === "calendar" && <CalendarView />}
                {view === "stats" && <StatsView />}
                {view === "library" && <LibraryView />}
              </motion.div>
            </div>
          </main>
        </>
      )}

      <HabitDialog />
      <CustomizePanel />

      <AnimatePresence>
        {toast && (
          <motion.div
            className="toast"
            key={toast.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            <CheckCircle2 size={15} strokeWidth={1.5} /> {toast.text}
            {!isTauri && <span className="quiet-meta">· демо-режим</span>}
          </motion.div>
        )}
      </AnimatePresence>

      {crash && <CrashScreen />}
    </div>
  );
}
