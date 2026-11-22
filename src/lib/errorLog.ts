import { api, isTauri } from "./api";
import type { LogEntry } from "./types";

const KEY = "voidtrack:error-log:v1";
const LIMIT = 200;

export interface CrashInfo {
  message: string;
  stack: string;
  source: string;
  time: string;
}

type Listener = (crash: CrashInfo | null) => void;

let crash: CrashInfo | null = null;
const listeners = new Set<Listener>();

function readClient(): LogEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]") as LogEntry[];
    return Array.isArray(parsed) ? parsed.slice(-LIMIT) : [];
  } catch {
    return [];
  }
}

function writeClient(entries: LogEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(-LIMIT)));
  } catch {
    // Лог не должен ломать приложение, даже если хранилище заполнено.
  }
}

export function logEvent(
  level: "error" | "warn" | "info",
  source: string,
  message: string,
): void {
  const entry: LogEntry = {
    time: new Date().toISOString(),
    level,
    source,
    message: message.slice(0, 8000),
  };
  writeClient([...readClient(), entry]);
  if (isTauri) void api.appendLog(level, `[${source}] ${message}`).catch(() => undefined);
}

export function reportCrash(error: unknown, source = "frontend"): void {
  const value = error instanceof Error ? error : new Error(String(error));
  const info: CrashInfo = {
    message: value.message || String(error),
    stack: value.stack ?? "",
    source,
    time: new Date().toISOString(),
  };
  logEvent("error", source, `${info.message}\n${info.stack}`.trim());
  crash = info;
  listeners.forEach((listener) => listener(crash));
}

export function currentCrash(): CrashInfo | null {
  return crash;
}

export function subscribeCrash(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function dismissCrash(): void {
  crash = null;
  listeners.forEach((listener) => listener(null));
}

export async function readAllLogs(): Promise<LogEntry[]> {
  const client = readClient();
  let native: LogEntry[] = [];
  if (isTauri) {
    try {
      native = await api.readLogs(LIMIT);
    } catch {
      native = [];
    }
  }
  return [...client, ...native]
    .filter((entry) => entry && typeof entry.message === "string")
    .sort((a, b) => String(b.time).localeCompare(String(a.time)))
    .slice(0, LIMIT);
}

export async function clearAllLogs(): Promise<void> {
  writeClient([]);
  if (isTauri) {
    try {
      await api.clearLogs();
    } catch {
      // Очищаем хотя бы локальную часть.
    }
  }
}

export function installGlobalErrorHandlers(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("error", (event) => {
    if (event.target && event.target !== window) return;
    reportCrash(event.error ?? event.message, "window.onerror");
  });
  window.addEventListener("unhandledrejection", (event) => {
    reportCrash(event.reason, "unhandledrejection");
  });
}
