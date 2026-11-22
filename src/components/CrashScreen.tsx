import { useEffect, useState } from "react";
import { AlertTriangle, Copy, RotateCcw, X } from "lucide-react";
import {
  clearAllLogs,
  currentCrash,
  dismissCrash,
  readAllLogs,
  subscribeCrash,
  type CrashInfo,
} from "../lib/errorLog";
import type { LogEntry } from "../lib/types";

async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // WebView иногда запрещает Clipboard API — пробуем старый способ.
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  area.remove();
}

export default function CrashScreen({ onDismiss }: { onDismiss?: () => void } = {}) {
  const [crash, setCrash] = useState<CrashInfo | null>(currentCrash());
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeCrash(setCrash);
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!crash) return;
    let alive = true;
    void readAllLogs().then((entries) => {
      if (alive) setLogs(entries);
    });
    return () => {
      alive = false;
    };
  }, [crash]);

  if (!crash) return null;

  const logText = [
    `VoidTrack · ${crash.time}`,
    `Источник: ${crash.source}`,
    `Ошибка: ${crash.message}`,
    crash.stack ? `Стек:\n${crash.stack}` : "",
    "--- Журнал ---",
    ...logs.map((entry) => `${entry.time} [${entry.level}] ${entry.source}: ${entry.message}`),
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div className="crash-overlay" role="alert">
      <div className="glass crash-card">
        <div className="crash-head">
          <div className="crash-icon"><AlertTriangle size={20} strokeWidth={1.5} /></div>
          <div>
            <h2>Что-то пошло не так</h2>
            <p>Ошибка записана в журнал — его можно скопировать и отправить.</p>
          </div>
          <button
            className="icon-btn"
            onClick={() => {
              dismissCrash();
              onDismiss?.();
            }}
            aria-label="Закрыть"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        <div className="crash-message">{crash.message}</div>
        {crash.stack && <pre className="crash-stack">{crash.stack}</pre>}

        <div className="crash-log-head">
          <strong>Журнал ошибок</strong>
          <span className="quiet-meta">{logs.length} записей</span>
        </div>
        <div className="crash-log">
          {logs.length === 0 ? (
            <div className="quiet-meta">Записей пока нет.</div>
          ) : (
            logs.map((entry, index) => (
              <div key={`${entry.time}-${index}`} className="crash-log-row">
                <span className={`log-level ${entry.level}`}>{entry.level}</span>
                <span className="quiet-meta">{String(entry.time).slice(11, 19) || entry.time}</span>
                <span>{entry.message}</span>
              </div>
            ))
          )}
        </div>

        <div className="crash-actions">
          <button
            className="ghost-btn"
            onClick={() => {
              void copyText(logText).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1800);
              });
            }}
          >
            <Copy size={14} strokeWidth={1.5} /> {copied ? "Скопировано" : "Скопировать лог"}
          </button>
          <button
            className="ghost-btn"
            onClick={() => {
              void clearAllLogs().then(() => setLogs([]));
            }}
          >
            Очистить
          </button>
          <button className="primary-btn" onClick={() => window.location.reload()}>
            <RotateCcw size={14} strokeWidth={1.5} /> Перезапустить
          </button>
        </div>
      </div>
    </div>
  );
}
