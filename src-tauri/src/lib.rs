mod catalog;
mod db;
mod logs;
mod models;
mod reminders;

use std::sync::OnceLock;

use tauri::{Manager, State};

use crate::db::{now_info, Database};
use crate::models::{
    Checkin, Habit, HabitReminder, HabitReminderInput, ImportSummary, LogEntry, NewHabit,
    NotificationStatus, NowInfo, ReminderSettings, Suggestion,
};

/// Хук запуска нужен, чтобы записать в журнал даже ошибку самого `.run()`.
static APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();

#[tauri::command]
fn list_habits(db: State<'_, Database>) -> Result<Vec<Habit>, String> {
    db.list_habits()
}

#[tauri::command]
fn list_checkins(db: State<'_, Database>) -> Result<Vec<Checkin>, String> {
    db.list_checkins()
}

#[tauri::command]
fn create_habit(input: NewHabit, db: State<'_, Database>) -> Result<Habit, String> {
    db.create_habit(input)
}

#[tauri::command]
fn update_habit(id: String, input: NewHabit, db: State<'_, Database>) -> Result<Habit, String> {
    db.update_habit(&id, input)
}

#[tauri::command]
fn archive_habit(id: String, archived: bool, db: State<'_, Database>) -> Result<(), String> {
    db.archive_habit(&id, archived)
}

#[tauri::command]
fn delete_habit(id: String, db: State<'_, Database>) -> Result<(), String> {
    db.delete_habit(&id)
}

#[tauri::command]
fn toggle_checkin(habit_id: String, date: String, db: State<'_, Database>) -> Result<bool, String> {
    db.toggle_checkin(&habit_id, &date)
}

#[tauri::command]
fn set_checkin_note(
    habit_id: String,
    date: String,
    note: String,
    db: State<'_, Database>,
) -> Result<(), String> {
    db.set_checkin_note(&habit_id, &date, &note)
}

#[tauri::command]
fn reorder_habits(ids: Vec<String>, db: State<'_, Database>) -> Result<(), String> {
    db.reorder_habits(ids)
}

#[tauri::command]
fn habit_streak(habit_id: String, db: State<'_, Database>) -> Result<i64, String> {
    db.habit_streak(&habit_id)
}

#[tauri::command]
fn now() -> NowInfo {
    now_info()
}

#[tauri::command]
fn suggest_habits(query: String, limit: Option<usize>) -> Vec<Suggestion> {
    catalog::suggest(&query, limit.unwrap_or(6))
}

#[tauri::command]
fn export_data(db: State<'_, Database>) -> Result<String, String> {
    db.export_data()
}

#[tauri::command]
fn import_data(content: String, mode: String, db: State<'_, Database>) -> Result<ImportSummary, String> {
    db.import_data(&content, &mode)
}

#[tauri::command]
fn append_log(level: String, message: String, db: State<'_, Database>) -> Result<(), String> {
    db.append_log(&level, "frontend", &message)
}

#[tauri::command]
fn read_logs(limit: Option<usize>, db: State<'_, Database>) -> Result<Vec<LogEntry>, String> {
    db.read_logs(limit.unwrap_or(200))
}

#[tauri::command]
fn clear_logs(db: State<'_, Database>) -> Result<(), String> {
    db.clear_logs()
}

#[tauri::command]
fn reminder_settings(db: State<'_, Database>) -> Result<ReminderSettings, String> {
    db.reminder_settings()
}

#[tauri::command]
fn save_reminder_settings(
    settings: ReminderSettings,
    app: tauri::AppHandle,
    db: State<'_, Database>,
) -> Result<ReminderSettings, String> {
    let settings = db.save_reminder_settings(settings)?;
    reminders::on_config_changed(&app, None);
    Ok(settings)
}

#[tauri::command]
fn list_habit_reminders(db: State<'_, Database>) -> Result<Vec<HabitReminder>, String> {
    db.list_habit_reminders()
}

#[tauri::command]
fn habit_reminder(habit_id: String, db: State<'_, Database>) -> Result<HabitReminder, String> {
    db.habit_reminder(&habit_id)
}

#[tauri::command]
fn save_habit_reminder(
    habit_id: String,
    reminder: HabitReminderInput,
    app: tauri::AppHandle,
    db: State<'_, Database>,
) -> Result<HabitReminder, String> {
    let habit = db
        .list_habits()?
        .into_iter()
        .find(|item| item.id == habit_id)
        .ok_or_else(|| "Привычка не найдена".to_string())?;
    let saved = db.save_habit_reminder(&habit, reminder)?;
    reminders::on_config_changed(&app, Some(&habit_id));
    Ok(saved)
}

#[tauri::command]
fn notification_status(app: tauri::AppHandle) -> Result<NotificationStatus, String> {
    reminders::status(&app)
}

#[tauri::command]
fn request_notification_permission(app: tauri::AppHandle) -> Result<String, String> {
    reminders::request_permission(&app)
}

#[tauri::command]
fn test_reminder(habit_id: String, app: tauri::AppHandle) -> Result<(), String> {
    reminders::test(&app, &habit_id)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let _ = APP_HANDLE.set(app.handle().clone());
            // Логгер ставим ДО открытия базы: иначе ошибку старта некуда писать.
            logs::init(app.handle());
            logs::log(app.handle(), "info", "startup", "VoidTrack запущен");

            let database = match Database::open(app.handle()) {
                Ok(database) => database,
                Err(error) => {
                    let message = error.to_string();
                    logs::log(
                        app.handle(),
                        "error",
                        "startup",
                        &format!("Не удалось открыть базу: {message}"),
                    );
                    eprintln!("[VoidTrack] не удалось открыть базу: {message}");
                    // Возвращаем тот же Box<dyn Error>, ничего не прячем за `?`.
                    return Err(error);
                }
            };
            app.manage(database);
            reminders::start(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_habits,
            list_checkins,
            create_habit,
            update_habit,
            archive_habit,
            delete_habit,
            toggle_checkin,
            set_checkin_note,
            reorder_habits,
            habit_streak,
            now,
            suggest_habits,
            export_data,
            import_data,
            append_log,
            read_logs,
            clear_logs,
            reminder_settings,
            save_reminder_settings,
            list_habit_reminders,
            habit_reminder,
            save_habit_reminder,
            notification_status,
            request_notification_permission,
            test_reminder
        ])
        .run(tauri::generate_context!());

    if let Err(error) = result {
        let message = error.to_string();
        if let Some(app) = APP_HANDLE.get() {
            logs::log(app, "error", "runtime", &message);
        }
        eprintln!("[VoidTrack] error while running VoidTrack: {message}");
        // Паника — только как последняя мера: до неё ошибка уже в журнале.
        panic!("error while running VoidTrack: {message}");
    }
}
