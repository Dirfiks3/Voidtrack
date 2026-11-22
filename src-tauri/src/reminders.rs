//! Сервис напоминаний VoidTrack.
//!
//! Desktop: собственный планировщик в Rust, потому что плагин уведомлений Tauri
//! умеет отложенный запуск только на мобильных. Потоки спят 15 секунд и почти
//! не расходуют ресурс; все решения принимаются по локальному времени.
//!
//! Mobile: нативные повторяющиеся уведомления через `tauri-plugin-notification`,
//! чтобы они приходили даже когда приложение закрыто.

use std::collections::hash_map::DefaultHasher;
use std::collections::HashSet;
use std::hash::{Hash, Hasher};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::thread;
use std::time::Duration as StdDuration;
#[cfg(mobile)]
use std::sync::{Mutex, OnceLock};
#[cfg(mobile)]
use std::time::Instant;

use chrono::{DateTime, Datelike, Local};
use tauri::plugin::PermissionState;
use tauri::{AppHandle, Manager, Runtime};
#[cfg(mobile)]
use tauri::Emitter;
use tauri_plugin_notification::NotificationExt;
#[cfg(mobile)]
use tauri_plugin_notification::{Action, ActionType, Schedule, ScheduleInterval};

use crate::db::Database;
use crate::models::{HabitReminder, NotificationStatus, ReminderSettings};

/// Стабильный small-positive id: Android и Windows используют его для замены
/// ранее показанного уведомления вместо создания нового.
fn stable_id(key: &str) -> i32 {
    let mut hasher = DefaultHasher::new();
    key.hash(&mut hasher);
    (hasher.finish() & 0x7fff_ffff) as i32
}

fn slot_of(time: DateTime<Local>) -> String {
    time.format("%Y-%m-%dT%H:%M").to_string()
}

fn minutes_of(hhmm: &str) -> u32 {
    let mut parts = hhmm.split(':');
    let hour = parts.next().and_then(|v| v.parse::<u32>().ok()).unwrap_or(0);
    let minute = parts.next().and_then(|v| v.parse::<u32>().ok()).unwrap_or(0);
    hour.min(23) * 60 + minute.min(59)
}

fn in_quiet_hours(minute: u32, settings: &ReminderSettings) -> bool {
    if !settings.quiet_hours_enabled {
        return false;
    }
    let start = minutes_of(&settings.quiet_start);
    let end = minutes_of(&settings.quiet_end);
    if start == end {
        return false;
    }
    if start < end {
        minute >= start && minute < end
    } else {
        minute >= start || minute < end
    }
}

/// Минуты суток, в которые должно приходить напоминание для привычки.
fn daily_slots(reminder: &HabitReminder, settings: &ReminderSettings) -> Vec<u32> {
    let mut slots: Vec<u32> = if reminder.mode == "times" {
        reminder
            .times
            .iter()
            .map(|value| minutes_of(value))
            .filter(|minute| !in_quiet_hours(*minute, settings))
            .collect()
    } else {
        let quiet_start = minutes_of(&settings.quiet_start);
        let quiet_end = minutes_of(&settings.quiet_end);
        let quiet_len = if settings.quiet_hours_enabled && quiet_start != quiet_end {
            if quiet_start < quiet_end {
                quiet_end - quiet_start
            } else {
                1440 - quiet_start + quiet_end
            }
        } else {
            0
        };
        let active_len = 1440 - quiet_len;
        let step = reminder.interval_minutes.clamp(30, 1440) as u32;
        let offset = if settings.quiet_hours_enabled {
            quiet_end
        } else {
            0
        };
        let count = active_len.div_ceil(step).clamp(1, 24);
        (0..count)
            .map(|index| (offset + index * step) % 1440)
            .filter(|minute| !in_quiet_hours(*minute, settings))
            .collect()
    };
    slots.sort_unstable();
    slots.dedup();
    slots
}

/// ISO (Пн=1 … Вс=7) → неделя плагина (Вс=1 … Сб=7).
#[cfg_attr(desktop, allow(dead_code))]
fn plugin_weekday(iso: i64) -> u8 {
    match iso {
        7 => 1,
        day => (day.clamp(1, 6) + 1) as u8,
    }
}

/// Следующий слот после `last_slot`, который уже наступил.
fn due_slot(
    date: DateTime<Local>,
    reminder: &HabitReminder,
    settings: &ReminderSettings,
    now_slot: &str,
) -> Option<String> {
    let iso = date.weekday().num_days_from_monday() as i64 + 1;
    if !reminder.days.contains(&iso) {
        return None;
    }
    let day = date.format("%Y-%m-%d").to_string();
    daily_slots(reminder, settings)
        .into_iter()
        .map(|minute| {
            format!(
                "{}T{:02}:{:02}",
                day,
                minute / 60,
                minute % 60
            )
        })
        .filter(|slot| {
            slot.as_str() <= now_slot
                && reminder
                    .last_fired_slot
                    .as_deref()
                    .is_none_or(|last| slot.as_str() > last)
        })
        .max()
        .and_then(|slot| {
            // Первый запуск: не догоняем пропущенные слоты, но если текущая
            // минута совпала со слотом — уведомление обязательно должно уйти.
            match reminder.last_fired_slot {
                None if slot != now_slot => None,
                _ => Some(slot),
            }
        })
}

fn show<R: Runtime>(app: &AppHandle<R>, id: i32, title: String, body: String) -> Result<(), String> {
    let result = app
        .notification()
        .builder()
        .id(id)
        .title(title.clone())
        .body(body)
        .show()
        .map_err(|error| error.to_string());
    // На Linux плагин пишет в D-Bus; без лога ошибка невидима пользователю.
    if let Err(error) = &result {
        let message = format!("не удалось показать уведомление {id} «{title}»: {error}");
        eprintln!("[VoidTrack] {message}");
        crate::logs::log(app, "error", "notifications", &message);
    }
    result
}

/// Один проход планировщика: проверяет все активные привычки.
fn check_due(app: &AppHandle) {
    let Some(database) = app.try_state::<Database>() else {
        return;
    };
    let Ok(settings) = database.reminder_settings() else {
        return;
    };
    if !settings.enabled {
        return;
    }

    let Ok(habits) = database.list_habits() else {
        return;
    };
    let Ok(reminders) = database.list_habit_reminders() else {
        return;
    };
    let Ok(checkins) = database.list_checkins() else {
        return;
    };

    let now = Local::now();
    let now_slot = slot_of(now);
    let today = now.format("%Y-%m-%d").to_string();
    let done: HashSet<&str> = checkins
        .iter()
        .filter(|checkin| checkin.date == today)
        .map(|checkin| checkin.habit_id.as_str())
        .collect();

    for habit in habits {
        if habit.archived {
            continue;
        }
        let Some(reminder) = reminders.iter().find(|item| item.habit_id == habit.id) else {
            continue;
        };
        if !reminder.enabled {
            continue;
        }
        if reminder.skip_if_done && done.contains(habit.id.as_str()) {
            continue;
        }

        // `due_slot` сам учитывает первый запуск: точное попадание в слот
        // показываем, пропущенные старые слоты не догоняем.
        let Some(slot) = due_slot(now, reminder, &settings, &now_slot) else {
            continue;
        };
        let title = HabitReminder::render(&reminder.title, &habit);
        let body = HabitReminder::render(&reminder.body, &habit);
        if show(app, stable_id(&format!("reminder:{}", habit.id)), title, body).is_err() {
            continue;
        }
        let _ = database.mark_reminder_fired(&habit.id, &slot);
    }
}

/// Держит отправителя: когда приложение закрывается, поток планировщика
/// получает `Disconnected` и завершается сам.
#[cfg(desktop)]
#[allow(dead_code)]
pub struct SchedulerGuard(pub Sender<()>);

pub fn start(app: &AppHandle) {
    #[cfg(mobile)]
    {
        // Действия регистрируем синхронно (это дешёвая операция), а все
        // нативные расписания — в фоне, чтобы WebView успел отрисоваться.
        register_actions(app);
        spawn_mobile_reschedule_worker(app);
    }

    #[cfg(desktop)]
    {
        let (sender, receiver) = mpsc::channel::<()>();
        app.manage(SchedulerGuard(sender));
        let scheduler = app.clone();
        if let Err(error) = thread::Builder::new()
            .name("voidtrack-reminders".into())
            .spawn(move || {
                desktop_permission_probe(&scheduler);
                // Первая проверка сразу в потоке, а не через 15 секунд.
                check_due(&scheduler);
                loop {
                    match receiver.recv_timeout(StdDuration::from_secs(15)) {
                        Ok(()) | Err(RecvTimeoutError::Timeout) => check_due(&scheduler),
                        Err(RecvTimeoutError::Disconnected) => break,
                    }
                }
            })
        {
            eprintln!("[VoidTrack] не удалось запустить планировщик: {error}");
        }
    }
}

/// На десктопе плагин всегда сообщает `Granted`, но на всякий случай
/// запрашиваем разрешение вне главного потока и пишем результат в журнал.
#[cfg(desktop)]
fn desktop_permission_probe(app: &AppHandle) {
    let message = match permission(app) {
        Ok(state) if state == "prompt" => match request_permission(app) {
            Ok(result) => format!("разрешение уведомлений запрошено: {state} -> {result}"),
            Err(error) => format!("не удалось запросить разрешение уведомлений: {error}"),
        },
        Ok(state) => format!("разрешение уведомлений: {state}"),
        Err(error) => format!("не удалось получить состояние разрешения: {error}"),
    };
    eprintln!("[VoidTrack] {message}");
    crate::logs::log(app, "info", "notifications", &message);
}

// --- Фоновые расписания на мобильном -------------------------------------

#[cfg(mobile)]
const RESCHEDULE_STARTUP_DELAY: StdDuration = StdDuration::from_millis(400);
#[cfg(mobile)]
const RESCHEDULE_DEBOUNCE: StdDuration = StdDuration::from_secs(1);

#[cfg(mobile)]
static RESCHEDULE_TX: OnceLock<Mutex<Sender<()>>> = OnceLock::new();
#[cfg(mobile)]
static LAST_RESCHEDULE: Mutex<Option<Instant>> = Mutex::new(None);

#[cfg(mobile)]
fn last_reschedule() -> Option<Instant> {
    *LAST_RESCHEDULE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(mobile)]
fn run_reschedule(app: &AppHandle, reason: &str) {
    reschedule(app, reason);
    if let Ok(mut guard) = LAST_RESCHEDULE.lock() {
        *guard = Some(Instant::now());
    }
}

#[cfg(mobile)]
fn spawn_mobile_reschedule_worker(app: &AppHandle) {
    let (sender, receiver) = mpsc::channel::<()>();
    if RESCHEDULE_TX.set(Mutex::new(sender)).is_err() {
        eprintln!("[VoidTrack] worker пересоздания расписаний уже запущен");
    }
    let worker_app = app.clone();
    if let Err(error) = thread::Builder::new()
        .name("voidtrack-reschedule".into())
        .spawn(move || {
            // Даём WebView ~400 мс на первый кадр до вызовов Binder/JNI.
            thread::sleep(RESCHEDULE_STARTUP_DELAY);
            run_reschedule(&worker_app, "startup");

            let mut pending = false;
            loop {
                match receiver.recv_timeout(RESCHEDULE_DEBOUNCE) {
                    Ok(()) => pending = true,
                    Err(RecvTimeoutError::Timeout) => {}
                    Err(RecvTimeoutError::Disconnected) => break,
                }
                if !pending {
                    continue;
                }
                while receiver.try_recv().is_ok() {}
                // Не чаще одного полного пересоздания в секунду.
                if let Some(last) = last_reschedule() {
                    if Instant::now().duration_since(last) < RESCHEDULE_DEBOUNCE {
                        continue;
                    }
                }
                pending = false;
                run_reschedule(&worker_app, "config-change");
            }
        })
    {
        eprintln!("[VoidTrack] не удалось запустить worker расписаний: {error}");
        crate::logs::log(app, "error", "reminders", &format!("ошибка worker расписаний: {error}"));
    }
}

#[cfg(mobile)]
fn register_actions(app: &AppHandle) {
    let notification = app.notification();
    let action_type = ActionType::builder("voidtrack.reminder")
        .actions(vec![Action::builder("done", "Отметил").build()])
        .build();
    let _ = notification.register_action_types(vec![action_type]);

    let handler_app = app.clone();
    let _ = notification.on_action(move |performed| {
        if performed.action_id() != "done" {
            return;
        }
        let Some(notification) = performed.notification() else {
            return;
        };
        let Some(habit_id) = notification
            .extra()
            .get("habitId")
            .and_then(|value| value.as_str())
        else {
            return;
        };
        let date = Local::now().format("%Y-%m-%d").to_string();
        if let Some(database) = handler_app.try_state::<Database>() {
            let _ = database.complete_habit_today(habit_id, &date);
        }
        let _ = handler_app.emit("reminder-completed", habit_id.to_string());
    });
}

/// Пересобирает нативные расписания Android после любого изменения настроек.
#[cfg(mobile)]
pub fn reschedule(app: &AppHandle, reason: &str) -> usize {
    let started = Instant::now();
    let report = |count: usize, detail: &str| {
        let message = format!(
            "пересоздание расписаний ({reason}): {count} шт. за {} мс — {detail}",
            started.elapsed().as_millis()
        );
        eprintln!("[VoidTrack] {message}");
        crate::logs::log(app, "info", "reminders", &message);
    };

    let Some(database) = app.try_state::<Database>() else {
        report(0, "база данных недоступна");
        return 0;
    };
    let Ok(settings) = database.reminder_settings() else {
        report(0, "не удалось прочитать настройки");
        return 0;
    };
    let Ok(habits) = database.list_habits() else {
        report(0, "не удалось прочитать привычки");
        return 0;
    };
    let Ok(reminders) = database.list_habit_reminders() else {
        report(0, "не удалось прочитать напоминания");
        return 0;
    };

    let notification = app.notification();
    if !settings.enabled {
        let _ = notification.cancel_all();
        report(0, "напоминания отключены");
        return 0;
    }

    #[cfg(target_os = "android")]
    {
        use tauri_plugin_notification::{Channel, Importance, Visibility};
        let channel = Channel::builder("voidtrack.reminders", "VoidTrack")
            .description("Напоминания о привычках")
            .importance(if settings.sound_enabled {
                Importance::Default
            } else {
                Importance::Low
            })
            .vibration(settings.vibration_enabled)
            .visibility(Visibility::Private)
            .build();
        let _ = notification.create_channel(channel);
    }

    // Действия уже зарегистрированы в register_actions() при запуске.
    let _ = notification.cancel_all();

    let mut scheduled = 0usize;
    let mut first_error: Option<String> = None;
    for habit in &habits {
        if habit.archived {
            continue;
        }
        let Some(reminder) = reminders.iter().find(|item| item.habit_id == habit.id) else {
            continue;
        };
        if !reminder.enabled {
            continue;
        }
        let title = HabitReminder::render(&reminder.title, habit);
        let body = HabitReminder::render(&reminder.body, habit);
        for day in &reminder.days {
            for minute in daily_slots(reminder, &settings) {
                let key = format!(
                    "{}|{}|{:02}:{:02}",
                    reminder.habit_id,
                    day,
                    minute / 60,
                    minute % 60
                );
                let mut builder = notification
                    .builder()
                    .id(stable_id(&key))
                    .title(title.clone())
                    .body(body.clone())
                    .action_type_id("voidtrack.reminder")
                    .extra("habitId", habit.id.clone())
                    .schedule(Schedule::Interval {
                        interval: ScheduleInterval {
                            weekday: Some(plugin_weekday(*day)),
                            hour: Some((minute / 60) as u8),
                            minute: Some((minute % 60) as u8),
                            ..Default::default()
                        },
                        allow_while_idle: true,
                    });
                #[cfg(target_os = "android")]
                {
                    builder = builder.channel_id("voidtrack.reminders");
                }
                match builder.show() {
                    Ok(()) => scheduled += 1,
                    Err(error) if first_error.is_none() => {
                        first_error = Some(error.to_string());
                        let message = format!("первое расписание отклонено: {error}");
                        eprintln!("[VoidTrack] {message}");
                        crate::logs::log(app, "error", "reminders", &message);
                    }
                    Err(_) => {}
                }
            }
        }
    }
    match first_error {
        Some(error) => report(scheduled, &format!("часть расписаний отклонена: {error}")),
        None => report(scheduled, "готово"),
    }
    scheduled
}

/// Вызывается из команд Tauri: на мобильном пересобирает расписание,
/// на десктопе просто сбрасывает точку отсчёта у изменённых привычек.
#[cfg_attr(mobile, allow(unused_variables))]
pub fn on_config_changed(app: &AppHandle, habit_id: Option<&str>) {
    #[cfg(mobile)]
    {
        // Команда вызывается на главном потоке: только кладём запрос в очередь.
        // worker сам прочитает актуальные настройки после дебаунса.
        let sent = RESCHEDULE_TX
            .get()
            .and_then(|sender| sender.lock().ok())
            .and_then(|sender| sender.send(()).ok())
            .is_some();
        if !sent {
            eprintln!("[VoidTrack] worker расписаний недоступен, отложенный перезапуск");
            let fallback_app = app.clone();
            if let Err(error) = thread::Builder::new()
                .name("voidtrack-reschedule-once".into())
                .spawn(move || {
                    thread::sleep(RESCHEDULE_DEBOUNCE);
                    run_reschedule(&fallback_app, "config-change-fallback");
                })
            {
                eprintln!("[VoidTrack] не удалось запланировать пересоздание: {error}");
            }
        }
    }

    #[cfg(desktop)]
    if let Some(habit_id) = habit_id {
        if let Some(database) = app.try_state::<Database>() {
            let _ = database.mark_reminder_fired(habit_id, &slot_of(Local::now()));
        }
    }
}

pub fn permission<R: Runtime>(app: &AppHandle<R>) -> Result<String, String> {
    let state = app
        .notification()
        .permission_state()
        .map_err(|error| error.to_string())?;
    Ok(match state {
        PermissionState::Granted => "granted".to_string(),
        PermissionState::Denied => "denied".to_string(),
        PermissionState::Prompt | PermissionState::PromptWithRationale => "prompt".to_string(),
    })
}

pub fn request_permission<R: Runtime>(app: &AppHandle<R>) -> Result<String, String> {
    let state = app
        .notification()
        .request_permission()
        .map_err(|error| error.to_string())?;
    Ok(match state {
        PermissionState::Granted => "granted".to_string(),
        PermissionState::Denied => "denied".to_string(),
        PermissionState::Prompt | PermissionState::PromptWithRationale => "prompt".to_string(),
    })
}

pub fn status<R: Runtime>(app: &AppHandle<R>) -> Result<NotificationStatus, String> {
    let database = app
        .try_state::<Database>()
        .ok_or_else(|| "База данных не готова".to_string())?;
    let settings = database.reminder_settings()?;
    let active_habits = database
        .list_habit_reminders()?
        .into_iter()
        .filter(|reminder| reminder.enabled)
        .count();

    #[cfg(mobile)]
    let scheduled_count = app.notification().pending().map(|items| items.len()).unwrap_or(0);
    #[cfg(desktop)]
    let scheduled_count = active_habits;

    // На Linux плагин всегда Granted, но если запрос состояния всё же упадёт,
    // статус не должен ломать всю панель настроек.
    #[cfg(desktop)]
    let permission_state = permission(app).unwrap_or_else(|error| {
        eprintln!("[VoidTrack] состояние разрешения уведомлений недоступно: {error}");
        "unknown".to_string()
    });
    #[cfg(mobile)]
    let permission_state = permission(app)?;

    Ok(NotificationStatus {
        permission: permission_state,
        platform: if cfg!(target_os = "android") {
            "android"
        } else {
            "desktop"
        }
        .to_string(),
        settings,
        active_habits,
        scheduled_count,
    })
}

/// Отправляет тестовое уведомление без изменения расписания.
pub fn test<R: Runtime>(app: &AppHandle<R>, habit_id: &str) -> Result<(), String> {
    let database = app
        .try_state::<Database>()
        .ok_or_else(|| "База данных не готова".to_string())?;
    let habit = database
        .list_habits()?
        .into_iter()
        .find(|item| item.id == habit_id)
        .ok_or_else(|| "Привычка не найдена".to_string())?;
    let reminder = database.habit_reminder(habit_id)?;
    show(
        app,
        stable_id(&format!("test:{}", habit_id)),
        HabitReminder::render(&reminder.title, &habit),
        HabitReminder::render(&reminder.body, &habit),
    )
}

#[cfg(test)]
mod tests {
    use super::{daily_slots, due_slot, in_quiet_hours, minutes_of};
    use crate::models::{HabitReminder, ReminderSettings};
    use chrono::{DateTime, Local, TimeZone};

    fn reminder(mode: &str, interval: i64, times: Vec<String>) -> HabitReminder {
        HabitReminder {
            habit_id: "h".into(),
            enabled: true,
            mode: mode.into(),
            interval_minutes: interval,
            times,
            days: vec![1, 2, 3, 4, 5, 6, 7],
            title: "t".into(),
            body: "b".into(),
            skip_if_done: true,
            last_fired_slot: None,
        }
    }

    fn with_last(mut value: HabitReminder, last: &str) -> HabitReminder {
        value.last_fired_slot = Some(last.into());
        value
    }

    fn local(hour: u32, minute: u32) -> DateTime<Local> {
        // 2026-11-22 — воскресенье (ISO 7), входит в days по умолчанию.
        Local
            .with_ymd_and_hms(2026, 11, 22, hour, minute, 0)
            .single()
            .unwrap()
    }

    #[test]
    fn every_three_and_half_hours() {
        let slots = daily_slots(&reminder("interval", 210, vec![]), &ReminderSettings::default());
        assert_eq!(slots, vec![0, 210, 420, 630, 840, 1050, 1260]);
    }

    #[test]
    fn quiet_hours_are_respected() {
        let settings = ReminderSettings {
            quiet_hours_enabled: true,
            quiet_start: "23:00".into(),
            quiet_end: "08:00".into(),
            ..Default::default()
        };
        assert!(in_quiet_hours(minutes_of("23:30"), &settings));
        assert!(in_quiet_hours(minutes_of("07:59"), &settings));
        assert!(!in_quiet_hours(minutes_of("08:00"), &settings));
        let slots = daily_slots(&reminder("interval", 210, vec![]), &settings);
        assert_eq!(slots, vec![480, 690, 900, 1110, 1320]);
    }

    #[test]
    fn fixed_times_are_sorted() {
        let slots = daily_slots(
            &reminder("times", 210, vec!["21:00".into(), "09:00".into(), "09:00".into()]),
            &ReminderSettings::default(),
        );
        assert_eq!(slots, vec![540, 1260]);
    }

    #[test]
    fn first_run_fires_exact_slot_but_not_a_stale_one() {
        let settings = ReminderSettings::default();
        let initial = reminder("interval", 210, vec![]);
        assert_eq!(
            due_slot(local(14, 0), &initial, &settings, "2026-11-22T14:00"),
            Some("2026-11-22T14:00".to_string())
        );
        // Пришли в 14:05 впервые — слот 14:00 уже прошёл, не догоняем.
        assert_eq!(
            due_slot(local(14, 5), &initial, &settings, "2026-11-22T14:05"),
            None
        );
    }

    #[test]
    fn due_slot_advances_after_last_fired_and_never_repeats() {
        let settings = ReminderSettings::default();
        let previous = with_last(reminder("interval", 210, vec![]), "2026-11-22T10:30");
        assert_eq!(
            due_slot(local(14, 5), &previous, &settings, "2026-11-22T14:05"),
            Some("2026-11-22T14:00".to_string())
        );

        let fired = with_last(reminder("interval", 210, vec![]), "2026-11-22T14:00");
        assert_eq!(
            due_slot(local(14, 5), &fired, &settings, "2026-11-22T14:05"),
            None
        );
    }

    #[test]
    fn due_slot_respects_days() {
        let settings = ReminderSettings::default();
        let mut only_monday = reminder("interval", 210, vec![]);
        only_monday.days = vec![1];
        assert_eq!(
            due_slot(local(14, 0), &only_monday, &settings, "2026-11-22T14:00"),
            None
        );
    }
}
