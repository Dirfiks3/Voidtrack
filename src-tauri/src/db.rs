use std::{fs, path::{Path, PathBuf}, sync::Mutex};
use std::collections::HashSet;

use chrono::{Datelike, Duration, Local};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{de::DeserializeOwned, Serialize};
use tauri::{AppHandle, Manager, Runtime};
use uuid::Uuid;

use crate::models::{
    default_weekdays, Checkin, Habit, HabitReminder, HabitReminderInput, ImportSummary, LogEntry,
    NewHabit, NowInfo, ReminderSettings,
};

const MIGRATIONS: &str = "
CREATE TABLE IF NOT EXISTS habits (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    icon TEXT NOT NULL DEFAULT 'sparkles',
    color TEXT NOT NULL DEFAULT 'violet',
    category TEXT NOT NULL DEFAULT 'Развитие',
    created_at TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0,
    target_per_week INTEGER NOT NULL DEFAULT 7,
    sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS checkins (
    id TEXT PRIMARY KEY,
    habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    created_at TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    UNIQUE(habit_id, date)
);
CREATE INDEX IF NOT EXISTS idx_checkins_date ON checkins(date);
CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS habit_reminders (
    habit_id TEXT PRIMARY KEY REFERENCES habits(id) ON DELETE CASCADE,
    enabled INTEGER NOT NULL DEFAULT 1,
    mode TEXT NOT NULL DEFAULT 'interval',
    interval_minutes INTEGER NOT NULL DEFAULT 210,
    times TEXT NOT NULL DEFAULT '[]',
    days TEXT NOT NULL DEFAULT '[1,2,3,4,5,6,7]',
    title TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    skip_if_done INTEGER NOT NULL DEFAULT 1,
    last_fired_slot TEXT
);
CREATE TABLE IF NOT EXISTS error_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    time TEXT NOT NULL,
    level TEXT NOT NULL,
    source TEXT NOT NULL,
    message TEXT NOT NULL
);
";

const MAX_NOTE_CHARS: usize = 4000;
const MAX_LOG_CHARS: usize = 8000;
const MAX_IMPORT_BYTES: usize = 8 * 1024 * 1024;

const WEEKDAYS_RU: [&str; 7] = [
    "воскресенье",
    "понедельник",
    "вторник",
    "среда",
    "четверг",
    "пятница",
    "суббота",
];

const WEEKDAYS_SHORT_RU: [&str; 7] = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

const MONTHS_RU: [&str; 12] = [
    "января",
    "февраля",
    "марта",
    "апреля",
    "мая",
    "июня",
    "июля",
    "августа",
    "сентября",
    "октября",
    "ноября",
    "декабря",
];

pub struct Database {
    conn: Mutex<Connection>,
}

/// Единый путь к базе: его используют и основное хранилище, и аварийный логгер.
/// Desktop: `dirs::data_local_dir()/VoidTrack`, резерв — каталог приложения.
/// Android: сначала `app_data_dir()` (там гарантированно есть доступ),
/// и только если Tauri его не выдал — `dirs::data_local_dir()/VoidTrack`.
pub fn database_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let root = {
        #[cfg(target_os = "android")]
        {
            match app.path().app_data_dir() {
                Ok(dir) => dir,
                Err(app_error) => match dirs::data_local_dir() {
                    Some(dir) => {
                        let fallback = dir.join("VoidTrack");
                        eprintln!(
                            "[VoidTrack] app_data_dir недоступен ({app_error}), резерв: {}",
                            fallback.display()
                        );
                        fallback
                    }
                    None => {
                        return Err(format!(
                            "не удалось определить папку данных приложения: {app_error}; локальная папка тоже недоступна"
                        ));
                    }
                },
            }
        }
        #[cfg(not(target_os = "android"))]
        {
            match dirs::data_local_dir() {
                Some(dir) => dir.join("VoidTrack"),
                None => app
                    .path()
                    .app_data_dir()
                    .map_err(|e| format!("не удалось определить папку данных приложения: {e}"))?,
            }
        }
    };
    fs::create_dir_all(&root).map_err(|e| {
        format!("не удалось создать папку данных «{}»: {e}", root.display())
    })?;
    Ok(root.join("voidtrack.db"))
}

/// CRLF -> LF, затем жёсткое ограничение по символам (не байтам).
fn normalize_note(value: &str) -> String {
    value.replace("\r\n", "\n").chars().take(MAX_NOTE_CHARS).collect()
}

/// Экранирование текстовых значений формата `.track`.
fn escape_text(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            _ => out.push(ch),
        }
    }
    out
}

/// Обратное экранирование; неизвестные последовательности сохраняются как есть.
fn unescape_text(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut chars = value.chars();
    while let Some(ch) = chars.next() {
        if ch != '\\' {
            out.push(ch);
            continue;
        }
        match chars.next() {
            Some('n') => out.push('\n'),
            Some('r') => out.push('\r'),
            Some('\\') => out.push('\\'),
            Some(other) => {
                out.push('\\');
                out.push(other);
            }
            None => out.push('\\'),
        }
    }
    out
}

/// Простая проверка `YYYY-MM-DD` без регулярных выражений.
fn valid_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return false;
    }
    let digits = |range: std::ops::Range<usize>| -> Option<u32> {
        let slice = &bytes[range];
        if slice.iter().all(u8::is_ascii_digit) {
            std::str::from_utf8(slice).ok()?.parse::<u32>().ok()
        } else {
            None
        }
    };
    match (digits(0..4), digits(5..7), digits(8..10)) {
        (Some(_), Some(month), Some(day)) => {
            (1..=12).contains(&month) && (1..=31).contains(&day)
        }
        _ => false,
    }
}

fn parse_i64_or(value: Option<&String>, fallback: i64) -> i64 {
    value
        .and_then(|raw| raw.trim().parse::<i64>().ok())
        .unwrap_or(fallback)
}

fn habit_from_row(row: &Row<'_>) -> rusqlite::Result<Habit> {
    let weekdays_raw: String = row.get(10)?;
    let weekdays: Vec<i64> = serde_json::from_str(&weekdays_raw).unwrap_or_else(|_| default_weekdays());
    Ok(Habit {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        icon: row.get(3)?,
        color: row.get(4)?,
        category: row.get(5)?,
        created_at: row.get(6)?,
        archived: row.get::<_, i64>(7)? != 0,
        target_per_week: row.get(8)?,
        schedule_type: row.get::<_, String>(9)?,
        weekdays,
        sort_order: row.get(11)?,
    })
}

fn checkin_from_row(row: &Row<'_>) -> rusqlite::Result<Checkin> {
    Ok(Checkin {
        id: row.get(0)?,
        habit_id: row.get(1)?,
        date: row.get(2)?,
        created_at: row.get(3)?,
        note: row.get(4)?,
    })
}

const HABIT_COLUMNS: &str =
    "id, name, description, icon, color, category, created_at, archived, target_per_week, schedule_type, weekdays, sort_order";

const CHECKIN_COLUMNS: &str = "id, habit_id, date, created_at, note";

/// Переносим базу целиком вместе с WAL/SHM, если файл ещё не скопирован.
fn copy_database(source_dir: &Path, source_name: &str, target_dir: &Path, target_name: &str) -> bool {
    let source = source_dir.join(source_name);
    if !source.exists() {
        return false;
    }
    let target = target_dir.join(target_name);
    if target.exists() {
        return false;
    }
    if let Err(error) = fs::create_dir_all(target_dir) {
        eprintln!("[VoidTrack] cannot create data dir: {error}");
        return false;
    }
    if let Err(error) = fs::copy(&source, &target) {
        eprintln!("[VoidTrack] cannot migrate database: {error}");
        return false;
    }
    for suffix in ["-wal", "-shm"] {
        let from = source_dir.join(format!("{source_name}{suffix}"));
        if from.exists() {
            let _ = fs::copy(from, target_dir.join(format!("{target_name}{suffix}")));
        }
    }
    true
}

fn ensure_column(conn: &Connection, table: &str, column: &str, ddl: &str) -> Result<(), String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|e| e.to_string())?;
    let names: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    drop(stmt);
    if !names.iter().any(|name| name == column) {
        conn.execute(ddl, []).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Полная схема: базовые таблицы плюс колонки, добавленные в более поздних версиях.
fn prepare_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(MIGRATIONS)
        .map_err(|e| format!("не удалось подготовить схему базы: {e}"))?;
    ensure_column(
        conn,
        "habits",
        "schedule_type",
        "ALTER TABLE habits ADD COLUMN schedule_type TEXT NOT NULL DEFAULT 'daily'",
    )?;
    ensure_column(
        conn,
        "habits",
        "weekdays",
        &format!(
            "ALTER TABLE habits ADD COLUMN weekdays TEXT NOT NULL DEFAULT '{}'",
            serde_json::to_string(&default_weekdays()).map_err(|e| e.to_string())?
        ),
    )?;
    ensure_column(
        conn,
        "habits",
        "sort_order",
        "ALTER TABLE habits ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_column(
        conn,
        "checkins",
        "note",
        "ALTER TABLE checkins ADD COLUMN note TEXT NOT NULL DEFAULT ''",
    )?;
    Ok(())
}

impl Database {
    pub fn open(app: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let db_path = database_path(app)?;
        let root: PathBuf = db_path
            .parent()
            .ok_or_else(|| format!("не удалось определить папку базы «{}»", db_path.display()))?
            .to_path_buf();

        // 1.Старый путь VoidTrack (com.voidtrack.app/app_data_dir).
        if !db_path.exists() {
            if let Ok(old_dir) = app.path().app_data_dir() {
                copy_database(&old_dir, "voidtrack.db", &root, "voidtrack.db");
            }
        }
        // 2.Легаси TrackPriv из app_data_dir.
        if !db_path.exists() {
            if let Ok(old_dir) = app.path().app_data_dir() {
                if let Some(parent) = old_dir.parent() {
                    copy_database(&parent.join("com.trackpriv.app"), "trackpriv.db", &root, "voidtrack.db");
                }
            }
        }
        // 3.Легаси TrackPriv из data_local_dir.
        if !db_path.exists() {
            if let Some(local) = dirs::data_local_dir() {
                copy_database(&local.join("TrackPriv"), "trackpriv.db", &root, "voidtrack.db");
            }
        }

        let conn = Connection::open(&db_path).map_err(|e| {
            format!("не удалось открыть базу «{}»: {e}", db_path.display())
        })?;
        if let Err(wal_error) = conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;") {
            #[cfg(target_os = "android")]
            {
                // На некоторых Android-устройствах WAL недоступен на data-разделе.
                let fallback = format!(
                    "WAL недоступен ({wal_error}), переходим на journal_mode=DELETE"
                );
                eprintln!("[VoidTrack] {fallback}");
                crate::logs::log(app, "warn", "database", &fallback);
                conn.execute_batch("PRAGMA journal_mode=DELETE; PRAGMA foreign_keys=ON;").map_err(
                    |e| format!("не удалось настроить SQLite (WAL и DELETE): {wal_error}; {e}"),
                )?;
            }
            #[cfg(not(target_os = "android"))]
            return Err(format!("не удалось включить journal_mode=WAL: {wal_error}").into());
        }
        prepare_schema(&conn)?;
        let database = Self {
            conn: Mutex::new(conn),
        };
        database.seed_if_empty()?;
        Ok(database)
    }

    fn seed_if_empty(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM habits", [], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        if count > 0 {
            return Ok(());
        }

        let now = Local::now();
        let created_at = (now - Duration::days(40)).to_rfc3339();
        let seeds: [(&str, &str, &str, &str, &str, i64, &str, Vec<i64>); 5] = [
            (
                "Утренняя медитация",
                "10 минут тишины с дыханием перед началом дня.",
                "brain",
                "violet",
                "Ментальное",
                7,
                "daily",
                default_weekdays(),
            ),
            (
                "Тренировка",
                "30 минут движения для тела и головы.",
                "dumbbell",
                "rose",
                "Здоровье",
                3,
                "custom",
                vec![1, 3, 5],
            ),
            (
                "Чтение 20 минут",
                "Книга вместо ленты — 20 минут без отвлечений.",
                "book",
                "cyan",
                "Развитие",
                5,
                "daily",
                default_weekdays(),
            ),
            (
                "Пить 2 литра воды",
                "8 стаканов воды ровно в течение дня.",
                "water",
                "blue",
                "Здоровье",
                7,
                "daily",
                default_weekdays(),
            ),
            (
                "Дневник благодарности",
                "Три вещи, за которые я сегодня благодарен.",
                "pen",
                "pink",
                "Ментальное",
                2,
                "custom",
                vec![2, 4, 6],
            ),
        ];

        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        for (
            index,
            (name, description, icon, color, category, target, schedule_type, weekdays),
        ) in seeds.iter().enumerate()
        {
            tx.execute(
                "INSERT INTO habits (id, name, description, icon, color, category, created_at, archived, target_per_week, schedule_type, weekdays, sort_order)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?9, ?10, ?11)",
                params![
                    format!("seed-{}", index + 1),
                    name,
                    description,
                    icon,
                    color,
                    category,
                    created_at,
                    target,
                    schedule_type,
                    serde_json::to_string(weekdays).map_err(|e| e.to_string())?,
                    index as i64,
                ],
            )
            .map_err(|e| e.to_string())?;
        }

        for (habit_index, (_, _, _, _, _, _, schedule_type, weekdays)) in seeds.iter().enumerate() {
            let chance = 0.78 - habit_index as f64 * 0.09;
            for days_ago in 0..28 {
                let day_date = (now - Duration::days(days_ago)).date_naive();
                let iso_weekday = day_date.weekday().num_days_from_monday() as i64 + 1;
                let scheduled = match &schedule_type[..] {
                    "weekdays" => iso_weekday <= 5,
                    "weekends" => iso_weekday >= 6,
                    _ => weekdays.contains(&iso_weekday),
                };
                if !scheduled {
                    continue;
                }
                let should_check = if days_ago == 0 {
                    habit_index % 2 == 0
                } else {
                    ((days_ago * 7 + habit_index as i64 * 3) % 10) as f64 / 10.0 < chance
                };
                if !should_check {
                    continue;
                }
                tx.execute(
                    "INSERT OR IGNORE INTO checkins (id, habit_id, date, created_at, note) VALUES (?1, ?2, ?3, ?4, '')",
                    params![
                        Uuid::new_v4().to_string(),
                        format!("seed-{}", habit_index + 1),
                        day_date.format("%Y-%m-%d").to_string(),
                        now.to_rfc3339(),
                    ],
                )
                .map_err(|e| e.to_string())?;
            }
        }
        tx.commit().map_err(|e| e.to_string())
    }

    pub fn list_habits(&self) -> Result<Vec<Habit>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(&format!(
                "SELECT {HABIT_COLUMNS} FROM habits ORDER BY sort_order ASC, created_at ASC"
            ))
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], habit_from_row)
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn create_habit(&self, input: NewHabit) -> Result<Habit, String> {
        let (schedule_type, weekdays) = input.effective_schedule();
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let sort_order: i64 = conn
            .query_row("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM habits", [], |row| {
                row.get(0)
            })
            .map_err(|e| e.to_string())?;
        let habit = Habit {
            id: Uuid::new_v4().to_string(),
            name: input.name,
            description: input.description,
            icon: input.icon,
            color: input.color,
            category: input.category,
            created_at: Local::now().to_rfc3339(),
            archived: false,
            target_per_week: input.target_per_week,
            schedule_type,
            weekdays,
            sort_order,
        };
        conn.execute(
            "INSERT INTO habits (id, name, description, icon, color, category, created_at, archived, target_per_week, schedule_type, weekdays, sort_order)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                habit.id,
                habit.name,
                habit.description,
                habit.icon,
                habit.color,
                habit.category,
                habit.created_at,
                habit.archived,
                habit.target_per_week,
                habit.schedule_type,
                serde_json::to_string(&habit.weekdays).map_err(|e| e.to_string())?,
                habit.sort_order,
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(habit)
    }

    pub fn update_habit(&self, id: &str, input: NewHabit) -> Result<Habit, String> {
        let (schedule_type, weekdays) = input.effective_schedule();
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE habits SET name=?2, description=?3, icon=?4, color=?5, category=?6, target_per_week=?7, schedule_type=?8, weekdays=?9 WHERE id=?1",
            params![
                id,
                input.name,
                input.description,
                input.icon,
                input.color,
                input.category,
                input.target_per_week,
                schedule_type,
                serde_json::to_string(&weekdays).map_err(|e| e.to_string())?,
            ],
        )
        .map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(&format!(
                "SELECT {HABIT_COLUMNS} FROM habits WHERE id=?1"
            ))
            .map_err(|e| e.to_string())?;
        stmt.query_row([id], habit_from_row)
            .map_err(|e| e.to_string())
    }

    /// Переставляет привычки по списку id. Неизвестные id игнорируются,
    /// остальные привычки остаются после указанных в прежнем относительном порядке.
    pub fn reorder_habits(&self, ids: Vec<String>) -> Result<(), String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let existing: Vec<String> = {
            let mut stmt = tx
                .prepare("SELECT id FROM habits ORDER BY sort_order ASC, created_at ASC")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        };

        // Повторы в запросе не должны «съедать» позиции следующих привычек.
        let mut ordered: Vec<String> = Vec::with_capacity(ids.len());
        let mut seen = HashSet::new();
        for id in ids {
            if seen.insert(id.clone()) {
                ordered.push(id);
            }
        }
        let requested: HashSet<&str> = ordered.iter().map(String::as_str).collect();

        for (index, id) in ordered.iter().enumerate() {
            tx.execute("UPDATE habits SET sort_order=?2 WHERE id=?1", params![id, index as i64])
                .map_err(|e| e.to_string())?;
        }
        let mut position = ordered.len() as i64;
        for id in existing.into_iter().filter(|id| !requested.contains(id.as_str())) {
            tx.execute("UPDATE habits SET sort_order=?2 WHERE id=?1", params![id, position])
                .map_err(|e| e.to_string())?;
            position += 1;
        }
        tx.commit().map_err(|e| e.to_string())
    }

    pub fn archive_habit(&self, id: &str, archived: bool) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE habits SET archived=?2 WHERE id=?1",
            params![id, archived as i64],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_habit(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM checkins WHERE habit_id=?1", params![id])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM habits WHERE id=?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_checkins(&self) -> Result<Vec<Checkin>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(&format!("SELECT {CHECKIN_COLUMNS} FROM checkins ORDER BY date DESC"))
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], checkin_from_row)
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn toggle_checkin(&self, habit_id: &str, date: &str) -> Result<bool, String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let existing: Option<String> = tx
            .query_row(
                "SELECT id FROM checkins WHERE habit_id=?1 AND date=?2",
                params![habit_id, date],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        let checked = match existing {
            Some(id) => {
                tx.execute("DELETE FROM checkins WHERE id=?1", params![id])
                    .map_err(|e| e.to_string())?;
                false
            }
            None => {
                tx.execute(
                    "INSERT INTO checkins (id, habit_id, date, created_at, note) VALUES (?1, ?2, ?3, ?4, '')",
                    params![
                        Uuid::new_v4().to_string(),
                        habit_id,
                        date,
                        Local::now().to_rfc3339()
                    ],
                )
                .map_err(|e| e.to_string())?;
                true
            }
        };
        tx.commit().map_err(|e| e.to_string())?;
        Ok(checked)
    }

    /// Сохраняет заметку отметки. Если отметки нет — ошибка, а не тихая вставка.
    pub fn set_checkin_note(&self, habit_id: &str, date: &str, note: &str) -> Result<(), String> {
        let note = normalize_note(note);
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let changed = conn
            .execute(
                "UPDATE checkins SET note=?3 WHERE habit_id=?1 AND date=?2",
                params![habit_id, date, note],
            )
            .map_err(|e| e.to_string())?;
        if changed == 0 {
            return Err("Отметка не найдена".to_string());
        }
        Ok(())
    }

    /// Серия с пропуском дней, на которые привычка не назначена.
    pub fn habit_streak(&self, habit_id: &str) -> Result<i64, String> {
        let habits = self.list_habits()?;
        let habit = habits
            .iter()
            .find(|item| item.id == habit_id)
            .ok_or_else(|| "Привычка не найдена".to_string())?;
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT date FROM checkins WHERE habit_id=?1")
            .map_err(|e| e.to_string())?;
        let done: std::collections::HashSet<String> = stmt
            .query_map([habit_id], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect();
        drop(stmt);
        drop(conn);

        let scheduled = |date: chrono::NaiveDate| -> bool {
            let iso = date.weekday().num_days_from_monday() as i64 + 1;
            match habit.schedule_type.as_str() {
                "weekdays" => iso <= 5,
                "weekends" => iso >= 6,
                _ => habit.weekdays.contains(&iso),
            }
        };

        let mut cursor = Local::now().date_naive();
        // Сегодня ещё не отмечено — не обрываем серию, начинаем со вчерашнего дня.
        if scheduled(cursor) && !done.contains(&cursor.format("%Y-%m-%d").to_string()) {
            cursor -= Duration::days(1);
        }

        let mut streak = 0i64;
        let mut guard = 0usize;
        while guard < 400 {
            guard += 1;
            if !scheduled(cursor) {
                cursor -= Duration::days(1);
                continue;
            }
            if !done.contains(&cursor.format("%Y-%m-%d").to_string()) {
                break;
            }
            streak += 1;
            cursor -= Duration::days(1);
        }
        Ok(streak)
    }

    // --- Текстовый бэкап `.track` ----------------------------------------

    /// Человекочитаемый экспорт: `#` комментарий, заголовок `VOIDTRACK 1`,
    /// секции `[habits]` / `[checkins]`, по блоку `key=value` на запись.
    pub fn export_data(&self) -> Result<String, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut out = String::new();
        out.push_str("# VoidTrack backup — text format\n");
        out.push_str("VOIDTRACK 1\n");
        out.push_str("[habits]\n");

        let habits = {
            let mut stmt = conn
                .prepare(&format!(
                    "SELECT {HABIT_COLUMNS} FROM habits ORDER BY sort_order ASC, created_at ASC"
                ))
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], habit_from_row)
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        };
        for habit in habits {
            let weekdays = habit
                .weekdays
                .iter()
                .map(|day| day.to_string())
                .collect::<Vec<_>>()
                .join(",");
            out.push('\n');
            out.push_str(&format!("id={}\n", escape_text(&habit.id)));
            out.push_str(&format!("name={}\n", escape_text(&habit.name)));
            out.push_str(&format!("description={}\n", escape_text(&habit.description)));
            out.push_str(&format!("icon={}\n", escape_text(&habit.icon)));
            out.push_str(&format!("color={}\n", escape_text(&habit.color)));
            out.push_str(&format!("category={}\n", escape_text(&habit.category)));
            out.push_str(&format!("created_at={}\n", escape_text(&habit.created_at)));
            out.push_str(&format!("archived={}\n", if habit.archived { 1 } else { 0 }));
            out.push_str(&format!("target_per_week={}\n", habit.target_per_week));
            out.push_str(&format!("schedule_type={}\n", escape_text(&habit.schedule_type)));
            out.push_str(&format!("weekdays={weekdays}\n"));
            out.push_str(&format!("sort_order={}\n", habit.sort_order));
        }

        out.push_str("\n[checkins]\n");
        let checkins = {
            let mut stmt = conn
                .prepare(&format!(
                    "SELECT {CHECKIN_COLUMNS} FROM checkins ORDER BY date DESC, id ASC"
                ))
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], checkin_from_row)
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        };
        for checkin in checkins {
            out.push('\n');
            out.push_str(&format!("id={}\n", escape_text(&checkin.id)));
            out.push_str(&format!("habit_id={}\n", escape_text(&checkin.habit_id)));
            out.push_str(&format!("date={}\n", escape_text(&checkin.date)));
            out.push_str(&format!("created_at={}\n", escape_text(&checkin.created_at)));
            out.push_str(&format!("note={}\n", escape_text(&checkin.note)));
        }
        Ok(out)
    }

    /// Ленивый разбор `.track`: комментарии и пустые строки игнорируются,
    /// секции могут идти в любом порядке, неизвестные ключи — тоже.
    pub fn import_data(&self, content: &str, mode: &str) -> Result<ImportSummary, String> {
        use std::collections::HashMap;

        if content.len() > MAX_IMPORT_BYTES {
            return Err(format!(
                "Файл слишком большой: более {} МиБ",
                MAX_IMPORT_BYTES / 1024 / 1024
            ));
        }
        if mode != "replace" && mode != "merge" {
            return Err("Неизвестный режим импорта".to_string());
        }

        let mut habit_blocks: Vec<HashMap<String, String>> = Vec::new();
        let mut checkin_blocks: Vec<HashMap<String, String>> = Vec::new();
        let mut current: HashMap<String, String> = HashMap::new();
        let mut section: &'static str = "";
        let mut found_section = false;

        fn flush(
            section: &str,
            current: &mut HashMap<String, String>,
            habits: &mut Vec<HashMap<String, String>>,
            checkins: &mut Vec<HashMap<String, String>>,
        ) {
            if current.is_empty() {
                return;
            }
            match section {
                "habits" => habits.push(std::mem::take(current)),
                "checkins" => checkins.push(std::mem::take(current)),
                _ => current.clear(),
            }
        }

        for raw in content.lines() {
            let line = raw.trim();
            if line.is_empty() {
                flush(section, &mut current, &mut habit_blocks, &mut checkin_blocks);
                continue;
            }
            if line.starts_with('#') {
                continue;
            }
            if line.starts_with('[') && line.ends_with(']') {
                flush(section, &mut current, &mut habit_blocks, &mut checkin_blocks);
                section = match &line[1..line.len() - 1] {
                    "habits" => "habits",
                    "checkins" => "checkins",
                    _ => "",
                };
                if !section.is_empty() {
                    found_section = true;
                }
                continue;
            }
            if section.is_empty() {
                continue;
            }
            if let Some((key, value)) = line.split_once('=') {
                current.insert(key.trim().to_string(), unescape_text(value.trim()));
            }
        }
        flush(section, &mut current, &mut habit_blocks, &mut checkin_blocks);

        if !found_section {
            return Err("Неверный формат файла: нет секций [habits] или [checkins]".to_string());
        }

        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        if mode == "replace" {
            tx.execute("DELETE FROM checkins", [])
                .map_err(|e| e.to_string())?;
            tx.execute("DELETE FROM habits", [])
                .map_err(|e| e.to_string())?;
        }

        let mut known: HashSet<String> = {
            let mut stmt = tx
                .prepare("SELECT id FROM habits")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<HashSet<_>, _>>()
                .map_err(|e| e.to_string())?
        };
        let mut summary = ImportSummary {
            habits: 0,
            checkins: 0,
            skipped: 0,
        };
        let now = Local::now().to_rfc3339();

        for block in habit_blocks {
            let id = block
                .get("id")
                .filter(|value| !value.is_empty())
                .cloned()
                .unwrap_or_else(|| Uuid::new_v4().to_string());
            let name = block.get("name").cloned().unwrap_or_default();
            let description = block.get("description").cloned().unwrap_or_default();
            let icon = block
                .get("icon")
                .filter(|value| !value.is_empty())
                .cloned()
                .unwrap_or_else(|| "sparkles".to_string());
            let color = block
                .get("color")
                .filter(|value| !value.is_empty())
                .cloned()
                .unwrap_or_else(|| "violet".to_string());
            let category = block
                .get("category")
                .filter(|value| !value.is_empty())
                .cloned()
                .unwrap_or_else(|| "Развитие".to_string());
            let created_at = block
                .get("created_at")
                .filter(|value| !value.is_empty())
                .cloned()
                .unwrap_or_else(|| now.clone());
            let archived = block.get("archived").map(|v| v == "1").unwrap_or(false);
            let target_per_week = parse_i64_or(block.get("target_per_week"), 7).clamp(1, 7);
            let weekdays: Vec<i64> = block
                .get("weekdays")
                .map(|raw| {
                    raw.split(',')
                        .filter_map(|part| part.trim().parse::<i64>().ok())
                        .filter(|day| (1..=7).contains(day))
                        .collect()
                })
                .unwrap_or_default();
            let input = NewHabit {
                name,
                description,
                icon,
                color,
                category,
                target_per_week,
                schedule_type: block
                    .get("schedule_type")
                    .cloned()
                    .unwrap_or_else(crate::models::default_schedule_type),
                weekdays,
            };
            let (schedule_type, weekdays) = input.effective_schedule();
            let sort_order = parse_i64_or(block.get("sort_order"), summary.habits);

            tx.execute(
                "INSERT INTO habits (id, name, description, icon, color, category, created_at, archived, target_per_week, schedule_type, weekdays, sort_order)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
                 ON CONFLICT(id) DO UPDATE SET
                    name=excluded.name, description=excluded.description,
                    icon=excluded.icon, color=excluded.color,
                    category=excluded.category, created_at=excluded.created_at,
                    archived=excluded.archived, target_per_week=excluded.target_per_week,
                    schedule_type=excluded.schedule_type, weekdays=excluded.weekdays,
                    sort_order=excluded.sort_order",
                params![
                    id,
                    input.name,
                    input.description,
                    input.icon,
                    input.color,
                    input.category,
                    created_at,
                    archived as i64,
                    target_per_week,
                    schedule_type,
                    serde_json::to_string(&weekdays).map_err(|e| e.to_string())?,
                    sort_order,
                ],
            )
            .map_err(|e| e.to_string())?;
            known.insert(id);
            summary.habits += 1;
        }

        for block in checkin_blocks {
            let habit_id = block.get("habit_id").cloned().unwrap_or_default();
            let date = block.get("date").cloned().unwrap_or_default();
            if !known.contains(&habit_id) || !valid_date(&date) {
                summary.skipped += 1;
                continue;
            }
            let id = block
                .get("id")
                .filter(|value| !value.is_empty())
                .cloned()
                .unwrap_or_else(|| Uuid::new_v4().to_string());
            let created_at = block
                .get("created_at")
                .filter(|value| !value.is_empty())
                .cloned()
                .unwrap_or_else(|| now.clone());
            let note = normalize_note(block.get("note").map(String::as_str).unwrap_or(""));
            tx.execute(
                "INSERT INTO checkins (id, habit_id, date, created_at, note)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(habit_id, date) DO UPDATE SET note=excluded.note",
                params![id, habit_id, date, created_at, note],
            )
            .map_err(|e| e.to_string())?;
            summary.checkins += 1;
        }

        tx.commit().map_err(|e| e.to_string())?;
        Ok(summary)
    }

    // --- Журнал ошибок ----------------------------------------------------

    pub fn append_log(&self, level: &str, source: &str, message: &str) -> Result<(), String> {
        let message: String = message.chars().take(MAX_LOG_CHARS).collect();
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO error_log (time, level, source, message) VALUES (?1, ?2, ?3, ?4)",
            params![Local::now().to_rfc3339(), level, source, message],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn read_logs(&self, limit: usize) -> Result<Vec<LogEntry>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT time, level, source, message FROM error_log ORDER BY id DESC LIMIT ?1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([limit as i64], |row| {
                Ok(LogEntry {
                    time: row.get(0)?,
                    level: row.get(1)?,
                    source: row.get(2)?,
                    message: row.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn clear_logs(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM error_log", [])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    // --- Настройки уведомлений -------------------------------------------

    fn read_setting<T: DeserializeOwned>(&self, key: &str) -> Result<Option<T>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let raw: Option<String> = conn
            .query_row("SELECT value FROM app_settings WHERE key=?1", [key], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|e| e.to_string())?;
        match raw {
            Some(raw) => serde_json::from_str(&raw)
                .map(Some)
                .map_err(|e| format!("Ошибка настройки {key}: {e}")),
            None => Ok(None),
        }
    }

    fn write_setting<T: Serialize>(&self, key: &str, value: &T) -> Result<(), String> {
        let raw = serde_json::to_string(value).map_err(|e| e.to_string())?;
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO app_settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![key, raw],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn reminder_settings(&self) -> Result<ReminderSettings, String> {
        let stored: Option<ReminderSettings> = self.read_setting("reminders.v1")?;
        let missing = stored.is_none();
        let settings = stored.unwrap_or_default().normalize();
        if missing {
            self.write_setting("reminders.v1", &settings)?;
        }
        Ok(settings)
    }

    pub fn save_reminder_settings(
        &self,
        settings: ReminderSettings,
    ) -> Result<ReminderSettings, String> {
        let settings = settings.normalize();
        self.write_setting("reminders.v1", &settings)?;
        Ok(settings)
    }

    fn reminder_from_row(row: &Row<'_>) -> rusqlite::Result<HabitReminder> {
        let times_raw: String = row.get(4)?;
        let days_raw: String = row.get(5)?;
        Ok(HabitReminder {
            habit_id: row.get(0)?,
            enabled: row.get::<_, i64>(1)? != 0,
            mode: row.get(2)?,
            interval_minutes: row.get(3)?,
            times: serde_json::from_str(&times_raw).unwrap_or_default(),
            days: serde_json::from_str(&days_raw).unwrap_or_else(|_| default_weekdays()),
            title: row.get(6)?,
            body: row.get(7)?,
            skip_if_done: row.get::<_, i64>(8)? != 0,
            last_fired_slot: row.get(9)?,
        })
    }

    const REMINDER_COLUMNS: &'static str =
        "habit_id, enabled, mode, interval_minutes, times, days, title, body, skip_if_done, last_fired_slot";

    pub fn list_habit_reminders(&self) -> Result<Vec<HabitReminder>, String> {
        let settings = self.reminder_settings()?;
        let habits = self.list_habits()?;
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(&format!(
                "SELECT {} FROM habit_reminders",
                Self::REMINDER_COLUMNS
            ))
            .map_err(|e| e.to_string())?;
        let stored: std::collections::HashMap<String, HabitReminder> = stmt
            .query_map([], Self::reminder_from_row)
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .map(|reminder| (reminder.habit_id.clone(), reminder))
            .collect();
        drop(stmt);
        drop(conn);

        Ok(habits
            .into_iter()
            .map(|habit| {
                stored
                    .get(&habit.id)
                    .cloned()
                    .unwrap_or_else(|| HabitReminder::default_for(&habit, &settings))
            })
            .collect())
    }

    pub fn habit_reminder(&self, habit_id: &str) -> Result<HabitReminder, String> {
        self.list_habit_reminders()?
            .into_iter()
            .find(|reminder| reminder.habit_id == habit_id)
            .ok_or_else(|| "Привычка не найдена".to_string())
    }

    pub fn save_habit_reminder(
        &self,
        habit: &Habit,
        input: HabitReminderInput,
    ) -> Result<HabitReminder, String> {
        let settings = self.reminder_settings()?;
        let reminder = HabitReminder::from_input(&habit.id, &habit.name, input, &settings);
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO habit_reminders
                (habit_id, enabled, mode, interval_minutes, times, days, title, body, skip_if_done, last_fired_slot)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL)
             ON CONFLICT(habit_id) DO UPDATE SET
                enabled=excluded.enabled, mode=excluded.mode,
                interval_minutes=excluded.interval_minutes, times=excluded.times,
                days=excluded.days, title=excluded.title, body=excluded.body,
                skip_if_done=excluded.skip_if_done",
            params![
                reminder.habit_id,
                reminder.enabled as i64,
                reminder.mode,
                reminder.interval_minutes,
                serde_json::to_string(&reminder.times).map_err(|e| e.to_string())?,
                serde_json::to_string(&reminder.days).map_err(|e| e.to_string())?,
                reminder.title,
                reminder.body,
                reminder.skip_if_done as i64,
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(reminder)
    }

    pub fn mark_reminder_fired(&self, habit_id: &str, slot: &str) -> Result<(), String> {
        // Если строки ещё нет, сохраняем полноценное напоминание по умолчанию:
        // иначе в уведомлениях оказались бы пустые заголовок и текст.
        let settings = self.reminder_settings()?;
        let default = self
            .list_habits()?
            .into_iter()
            .find(|habit| habit.id == habit_id)
            .map(|habit| HabitReminder::default_for(&habit, &settings));

        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let exists: Option<i64> = conn
            .query_row(
                "SELECT 1 FROM habit_reminders WHERE habit_id=?1",
                [habit_id],
                |_| Ok(1),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        if exists.is_some() {
            conn.execute(
                "UPDATE habit_reminders SET last_fired_slot=?2 WHERE habit_id=?1",
                params![habit_id, slot],
            )
            .map_err(|e| e.to_string())?;
        } else if let Some(reminder) = default {
            conn.execute(
                "INSERT INTO habit_reminders
                    (habit_id, enabled, mode, interval_minutes, times, days,
                     title, body, skip_if_done, last_fired_slot)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    reminder.habit_id,
                    reminder.enabled as i64,
                    reminder.mode,
                    reminder.interval_minutes,
                    serde_json::to_string(&reminder.times).map_err(|e| e.to_string())?,
                    serde_json::to_string(&reminder.days).map_err(|e| e.to_string())?,
                    reminder.title,
                    reminder.body,
                    reminder.skip_if_done as i64,
                    slot,
                ],
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    /// Отмечает выполнение из уведомления, не переключая существующую отметку.
    #[cfg_attr(desktop, allow(dead_code))]
    pub fn complete_habit_today(&self, habit_id: &str, date: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR IGNORE INTO checkins (id, habit_id, date, created_at, note) VALUES (?1, ?2, ?3, ?4, '')",
            params![Uuid::new_v4().to_string(), habit_id, date, Local::now().to_rfc3339()],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }
}

pub fn now_info() -> NowInfo {
    let now = Local::now();
    let iso = now.weekday().num_days_from_monday() as usize + 1;
    // chrono: 0 = воскресенье … 6 = суббота
    let ru_index = now.weekday().num_days_from_sunday() as usize;
    let day = now.day();
    let month = MONTHS_RU[(now.month() - 1) as usize];
    let year = now.year();
    NowInfo {
        date: now.format("%Y-%m-%d").to_string(),
        time: now.format("%H:%M").to_string(),
        weekday_ru: WEEKDAYS_RU[ru_index].to_string(),
        weekday_short: WEEKDAYS_SHORT_RU[ru_index].to_string(),
        month_ru: month.to_string(),
        label: format!("{day} {month} {year}, {}", WEEKDAYS_RU[ru_index]),
        iso_weekday: iso as i64,
    }
}

#[cfg(test)]
mod tests {
    use super::{ensure_column, now_info, prepare_schema, Database};
    use crate::models::NewHabit;
    use rusqlite::Connection;
    use std::sync::Mutex;

    fn memory_db() -> Database {
        let conn = Connection::open_in_memory().unwrap();
        prepare_schema(&conn).unwrap();
        Database {
            conn: Mutex::new(conn),
        }
    }

    fn sample_habit() -> NewHabit {
        NewHabit {
            name: "Тест".into(),
            description: "описание\nсо странным\\символом".into(),
            icon: "sparkles".into(),
            color: "violet".into(),
            category: "Тест".into(),
            target_per_week: 3,
            schedule_type: "custom".into(),
            weekdays: vec![1, 3, 5, 9],
        }
    }

    #[test]
    fn now_info_has_russian_weekday() {
        let info = now_info();
        assert!(info.label.contains(','));
        assert!(!info.weekday_ru.is_empty());
        assert!((1..=7).contains(&info.iso_weekday));
    }

    #[test]
    fn migration_adds_schedule_columns() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE habits (id TEXT PRIMARY KEY, name TEXT NOT NULL);",
        )
        .unwrap();
        ensure_column(
            &conn,
            "habits",
            "schedule_type",
            "ALTER TABLE habits ADD COLUMN schedule_type TEXT NOT NULL DEFAULT 'daily'",
        )
        .unwrap();
        ensure_column(
            &conn,
            "habits",
            "weekdays",
            "ALTER TABLE habits ADD COLUMN weekdays TEXT NOT NULL DEFAULT '[1,2,3,4,5,6,7]'",
        )
        .unwrap();
        // Повтор не должен ломать базу.
        ensure_column(
            &conn,
            "habits",
            "schedule_type",
            "ALTER TABLE habits ADD COLUMN schedule_type TEXT NOT NULL DEFAULT 'daily'",
        )
        .unwrap();
    }

    #[test]
    fn track_export_has_header_escaped_note_and_weekdays() {
        let db = memory_db();
        let habit = db.create_habit(sample_habit()).unwrap();
        db.toggle_checkin(&habit.id, "2026-11-21").unwrap();
        let note = "первая\\строка\nвторая\r\nтретья";
        db.set_checkin_note(&habit.id, "2026-11-21", note).unwrap();

        let text = db.export_data().unwrap();
        assert!(text.starts_with("# VoidTrack backup — text format\nVOIDTRACK 1\n[habits]\n"));
        assert!(text.contains("weekdays=1,3,5\n"));
        assert!(text.contains("sort_order=0\n"));
        assert!(text.contains("note=первая\\\\строка\\nвторая\\nтретья\n"));
        assert!(text.contains("\n[checkins]\n"));
    }

    #[test]
    fn track_import_roundtrip_and_skips_unknown_checkins() {
        let source = memory_db();
        let habit = source.create_habit(sample_habit()).unwrap();
        source.toggle_checkin(&habit.id, "2026-11-21").unwrap();
        let note = "первая\\строка\nвторая\r\nтретья";
        source.set_checkin_note(&habit.id, "2026-11-21", note).unwrap();
        let backup = source.export_data().unwrap();

        // Секции в обратном порядке, комментарии и пустые строки допустимы.
        let mut shuffled = String::from("# комментарий\n\n[checkins]\n");
        let (_, checkin_part) = backup.split_once("[checkins]\n").unwrap();
        shuffled.push_str(checkin_part);
        shuffled.push_str("\n[habits]\n");
        let (_, habit_part) = backup.split_once("[habits]\n").unwrap();
        shuffled.push_str(habit_part.split("\n[checkins]").next().unwrap());

        let target = memory_db();
        let summary = target.import_data(&shuffled, "replace").unwrap();
        assert_eq!((summary.habits, summary.checkins, summary.skipped), (1, 1, 0));
        assert_eq!(target.list_habits().unwrap()[0].weekdays, vec![1, 3, 5]);
        assert_eq!(target.list_checkins().unwrap()[0].note, note.replace("\r\n", "\n"));

        let junk = "[checkins]\n\nid=c1\nhabit_id=нет-такой\n date=2026-11-21\nnote=\n\nid=c2\nhabit_id=x\ndate=21.11.2026\nnote=\n";
        let summary = target.import_data(junk, "merge").unwrap();
        assert_eq!((summary.habits, summary.checkins, summary.skipped), (0, 0, 2));
    }

    #[test]
    fn reorder_and_note_errors_are_safe() {
        let db = memory_db();
        let first = db.create_habit(sample_habit()).unwrap();
        let second = db.create_habit(sample_habit()).unwrap();
        db.reorder_habits(vec![second.id.clone(), first.id.clone()])
            .unwrap();
        let ordered = db.list_habits().unwrap();
        assert_eq!(ordered[0].id, second.id);
        assert_eq!(ordered[1].id, first.id);

        assert_eq!(
            db.set_checkin_note(&first.id, "2026-11-21", "нет отметки"),
            Err("Отметка не найдена".to_string())
        );
    }
}
