//! Аварийное журналирование: записи и panic должны быть видны прямо с устройства.
//!
//! Пишем в тот же файл, что и основное хранилище, но отдельным соединением:
//! если основное соединение занято или отравлено panic, запись всё равно сохранится.
//! Ошибки здесь намеренно глушатся — логгер не должен ломать приложение.

use std::panic::PanicHookInfo;

use chrono::Local;
use rusqlite::params;
use tauri::{AppHandle, Runtime};

use crate::db::database_path;

const CREATE_ERROR_LOG: &str = "
CREATE TABLE IF NOT EXISTS error_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    time TEXT NOT NULL,
    level TEXT NOT NULL,
    source TEXT NOT NULL,
    message TEXT NOT NULL
);
";

const MAX_MESSAGE_CHARS: usize = 8000;

fn write_log<R: Runtime>(app: &AppHandle<R>, level: &str, source: &str, message: &str) {
    let path = match database_path(app) {
        Ok(path) => path,
        Err(error) => {
            eprintln!("[VoidTrack] log path unavailable: {error}");
            return;
        }
    };
    let conn = match rusqlite::Connection::open(&path) {
        Ok(conn) => conn,
        Err(error) => {
            eprintln!("[VoidTrack] log database unavailable: {error}");
            return;
        }
    };
    if let Err(error) = conn.execute_batch(CREATE_ERROR_LOG) {
        eprintln!("[VoidTrack] log table unavailable: {error}");
        return;
    }
    let message: String = message.chars().take(MAX_MESSAGE_CHARS).collect();
    if let Err(error) = conn.execute(
        "INSERT INTO error_log (time, level, source, message) VALUES (?1, ?2, ?3, ?4)",
        params![Local::now().to_rfc3339(), level, source, message],
    ) {
        eprintln!("[VoidTrack] cannot write log: {error}");
    }
}

/// Ставим перехват panic, обязательно вызывая предыдущий хук.
pub fn init<R: Runtime>(app: &AppHandle<R>) {
    let hook_app = app.clone();
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info: &PanicHookInfo<'_>| {
        let payload = if let Some(text) = info.payload().downcast_ref::<&str>() {
            (*text).to_string()
        } else if let Some(text) = info.payload().downcast_ref::<String>() {
            text.clone()
        } else {
            "неизвестный panic".to_string()
        };
        let location = info
            .location()
            .map(|place| format!("{}:{}:{}", place.file(), place.line(), place.column()))
            .unwrap_or_else(|| "место неизвестно".to_string());
        write_log(&hook_app, "panic", "panic-hook", &format!("{payload} @ {location}"));
        previous(info);
    }));
}

/// Обычная запись в журнал из Rust-кода.
pub fn log<R: Runtime>(app: &AppHandle<R>, level: &str, source: &str, message: &str) {
    write_log(app, level, source, message);
}
