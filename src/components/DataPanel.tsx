import { useEffect, useRef, useState } from "react";
import { Copy, Download, FileUp, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { clearAllLogs, logEvent, readAllLogs } from "../lib/errorLog";
import { useApp } from "../store";
import type { LogEntry } from "../lib/types";

async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // fallback below
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

export default function DataPanel() {
  const replaceData = useApp((state) => state.replaceData);
  const notify = useApp((state) => state.notify);
  const load = useApp((state) => state.load);
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const refreshLogs = () => {
    void readAllLogs().then(setLogs);
  };

  useEffect(refreshLogs, []);

  const doExport = async (download: boolean) => {
    setBusy(true);
    try {
      const content = await api.exportData();
      if (download) {
        const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `voidtrack-${new Date().toISOString().slice(0, 10)}.track`;
        anchor.click();
        URL.revokeObjectURL(url);
        notify("Файл .track сохранён");
      } else {
        await copyText(content);
        notify("Резервная копия скопирована");
      }
    } catch (error) {
      logEvent("error", "export", error instanceof Error ? error.message : String(error));
      notify("Не удалось выгрузить данные");
    } finally {
      setBusy(false);
    }
  };

  const doImport = async () => {
    const content = text.trim();
    if (!content) {
      notify("Вставьте содержимое .track или выберите файл");
      return;
    }
    setBusy(true);
    try {
      const summary = await api.importData(content, mode);
      const data = await api.getAppData();
      replaceData(data.habits, data.checkins);
      await load();
      setText("");
      notify(
        `Импорт: ${summary.habits} привычек, ${summary.checkins} отметок` +
          (summary.skipped ? `, пропущено ${summary.skipped}` : ""),
      );
    } catch (error) {
      logEvent("error", "import", error instanceof Error ? error.message : String(error));
      notify(error instanceof Error ? error.message : "Не удалось импортировать файл");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="customize-body">
      <section>
        <h3>Резервная копия</h3>
        <p className="quiet-meta">
          Свой текстовый формат .track — привычки, отметки и заметки. Без JSON и CSV.
        </p>
        <div className="data-actions">
          <button className="primary-btn" disabled={busy} onClick={() => void doExport(true)}>
            <Download size={14} strokeWidth={1.5} /> Скачать .track
          </button>
          <button className="ghost-btn" disabled={busy} onClick={() => void doExport(false)}>
            <Copy size={14} strokeWidth={1.5} /> Копировать
          </button>
        </div>
      </section>

      <section>
        <h3>Восстановление</h3>
        <div className="segmented compact">
          <button className={mode === "merge" ? "active" : ""} onClick={() => setMode("merge")}>
            Объединить
          </button>
          <button className={mode === "replace" ? "active" : ""} onClick={() => setMode("replace")}>
            Заменить всё
          </button>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept=".track,.txt,text/plain"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            void file.text().then(setText);
          }}
        />
        <button className="ghost-btn data-file" onClick={() => fileInput.current?.click()}>
          <FileUp size={14} strokeWidth={1.5} /> Выбрать файл .track
        </button>
        <textarea
          className="textarea data-import"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Или вставьте содержимое .track сюда"
          rows={5}
        />
        <button className="primary-btn" disabled={busy || !text.trim()} onClick={() => void doImport()}>
          Импортировать
        </button>
      </section>

      <section>
        <div className="crash-log-head">
          <h3>Журнал ошибок</h3>
          <span className="quiet-meta">{logs.length}</span>
        </div>
        <div className="crash-log">
          {logs.length === 0 ? (
            <div className="quiet-meta">Ошибок не зафиксировано.</div>
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
        <div className="data-actions">
          <button className="ghost-btn" onClick={refreshLogs}>
            Обновить
          </button>
          <button
            className="ghost-btn"
            onClick={() => {
              void clearAllLogs().then(refreshLogs);
            }}
          >
            <Trash2 size={14} strokeWidth={1.5} /> Очистить
          </button>
        </div>
      </section>
    </div>
  );
}
