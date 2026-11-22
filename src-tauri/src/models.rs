use serde::{Deserialize, Serialize};

/// стабильный идентификатор расписания:
/// daily / weekdays / weekends / custom
pub type ScheduleType = String;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Habit {
    pub id: String,
    pub name: String,
    pub description: String,
    pub icon: String,
    pub color: String,
    pub category: String,
    pub created_at: String,
    pub archived: bool,
    pub target_per_week: i64,
    pub schedule_type: ScheduleType,
    /// 1 = Пн … 7 = Вс
    pub weekdays: Vec<i64>,
    /// Порядок отображения (чем меньше, тем выше в списке).
    pub sort_order: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NewHabit {
    pub name: String,
    pub description: String,
    pub icon: String,
    pub color: String,
    pub category: String,
    pub target_per_week: i64,
    #[serde(default = "default_schedule_type")]
    pub schedule_type: ScheduleType,
    #[serde(default = "default_weekdays")]
    pub weekdays: Vec<i64>,
}

pub fn default_schedule_type() -> ScheduleType {
    "daily".to_string()
}

pub fn default_weekdays() -> Vec<i64> {
    (1..=7).collect()
}

impl NewHabit {
    pub fn effective_schedule(&self) -> (ScheduleType, Vec<i64>) {
        let kind = match self.schedule_type.as_str() {
            "weekdays" | "weekends" | "custom" => self.schedule_type.clone(),
            _ => "daily".to_string(),
        };
        let days = match kind.as_str() {
            "weekdays" => vec![1, 2, 3, 4, 5],
            "weekends" => vec![6, 7],
            "custom" => {
                let mut days: Vec<i64> = self
                    .weekdays
                    .iter()
                    .copied()
                    .filter(|day| (1..=7).contains(day))
                    .collect();
                days.sort_unstable();
                days.dedup();
                if days.is_empty() {
                    default_weekdays()
                } else {
                    days
                }
            }
            _ => default_weekdays(),
        };
        (kind, days)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Checkin {
    pub id: String,
    pub habit_id: String,
    pub date: String,
    pub created_at: String,
    /// Заметка к отметке. Старые записи и импорты без поля получают пустую строку.
    #[serde(default)]
    pub note: String,
}

/// Итог импорта бэкапа `.track` — возвращается фронтенду.
#[derive(Debug, Clone, Serialize)]
pub struct ImportSummary {
    pub habits: i64,
    pub checkins: i64,
    pub skipped: i64,
}

/// Строка журнала ошибок, доступного с устройства.
#[derive(Debug, Clone, Serialize)]
pub struct LogEntry {
    pub time: String,
    pub level: String,
    pub source: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct NowInfo {
    pub date: String,
    pub time: String,
    pub weekday_ru: String,
    pub weekday_short: String,
    pub month_ru: String,
    pub label: String,
    pub iso_weekday: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CatalogItem {
    pub name: String,
    pub description: String,
    pub icon: String,
    pub color: String,
    pub category: String,
    pub keywords: Vec<String>,
    #[serde(default)]
    pub popular: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Suggestion {
    pub name: String,
    pub description: String,
    pub icon: String,
    pub color: String,
    pub category: String,
    pub score: f64,
}

// --- Напоминания ---------------------------------------------------------

/// 3 часа 30 минут — «каждые 3–4 часа» по умолчанию.
pub const DEFAULT_REMINDER_INTERVAL: i64 = 210;
pub const MIN_REMINDER_INTERVAL: i64 = 30;
pub const MAX_REMINDER_INTERVAL: i64 = 1440;

pub fn clamp_interval(minutes: i64) -> i64 {
    minutes.clamp(MIN_REMINDER_INTERVAL, MAX_REMINDER_INTERVAL)
}

pub fn normalize_hhmm(value: &str, fallback: &str) -> String {
    let parts: Vec<&str> = value.trim().split(':').collect();
    if parts.len() != 2 {
        return fallback.to_string();
    }
    let hour = parts[0].parse::<u32>().ok();
    let minute = parts[1].parse::<u32>().ok();
    match (hour, minute) {
        (Some(h), Some(m)) if h < 24 && m < 60 => format!("{h:02}:{m:02}"),
        _ => fallback.to_string(),
    }
}

pub fn normalize_days(days: &[i64]) -> Vec<i64> {
    let mut result: Vec<i64> = days
        .iter()
        .copied()
        .filter(|day| (1..=7).contains(day))
        .collect();
    result.sort_unstable();
    result.dedup();
    if result.is_empty() {
        default_weekdays()
    } else {
        result
    }
}

pub fn normalize_times(times: &[String]) -> Vec<String> {
    let mut result: Vec<String> = times
        .iter()
        .filter_map(|value| {
            let normalized = normalize_hhmm(value, "");
            if normalized.is_empty() {
                None
            } else {
                Some(normalized)
            }
        })
        .collect();
    result.sort_unstable();
    result.dedup();
    result.truncate(12);
    if result.is_empty() {
        vec!["09:00".to_string()]
    } else {
        result
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReminderSettings {
    pub enabled: bool,
    pub quiet_hours_enabled: bool,
    pub quiet_start: String,
    pub quiet_end: String,
    /// 1 = Пн … 7 = Вс
    pub active_days: Vec<i64>,
    pub default_interval_minutes: i64,
    pub sound_enabled: bool,
    pub vibration_enabled: bool,
}

impl Default for ReminderSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            quiet_hours_enabled: false,
            quiet_start: "23:00".to_string(),
            quiet_end: "08:00".to_string(),
            active_days: default_weekdays(),
            default_interval_minutes: DEFAULT_REMINDER_INTERVAL,
            sound_enabled: true,
            vibration_enabled: true,
        }
    }
}

impl ReminderSettings {
    pub fn normalize(mut self) -> Self {
        self.quiet_start = normalize_hhmm(&self.quiet_start, "23:00");
        self.quiet_end = normalize_hhmm(&self.quiet_end, "08:00");
        self.active_days = normalize_days(&self.active_days);
        self.default_interval_minutes = clamp_interval(self.default_interval_minutes);
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HabitReminder {
    pub habit_id: String,
    pub enabled: bool,
    /// interval | times
    pub mode: String,
    pub interval_minutes: i64,
    pub times: Vec<String>,
    /// 1 = Пн … 7 = Вс
    pub days: Vec<i64>,
    pub title: String,
    pub body: String,
    pub skip_if_done: bool,
    /// Последний сработавший слот `YYYY-MM-DDTHH:MM` (локальное время).
    pub last_fired_slot: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct HabitReminderInput {
    #[serde(default = "default_reminder_enabled")]
    pub enabled: bool,
    #[serde(default = "default_reminder_mode")]
    pub mode: String,
    #[serde(default)]
    pub interval_minutes: i64,
    #[serde(default)]
    pub times: Vec<String>,
    #[serde(default = "default_weekdays")]
    pub days: Vec<i64>,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub body: String,
    #[serde(default = "default_skip_if_done")]
    pub skip_if_done: bool,
}

fn default_reminder_enabled() -> bool {
    true
}

fn default_reminder_mode() -> String {
    "interval".to_string()
}

fn default_skip_if_done() -> bool {
    true
}

pub fn default_reminder_title(name: &str) -> String {
    format!("{name} — пора")
}

pub fn default_reminder_body(name: &str) -> String {
    format!("Напоминание: {name}. Отметьте привычку, когда выполните.")
}

impl HabitReminder {
    pub fn from_input(
        habit_id: &str,
        habit_name: &str,
        input: HabitReminderInput,
        settings: &ReminderSettings,
    ) -> Self {
        let mode = match input.mode.as_str() {
            "times" => "times".to_string(),
            _ => "interval".to_string(),
        };
        let interval_minutes = if input.interval_minutes > 0 {
            clamp_interval(input.interval_minutes)
        } else {
            settings.default_interval_minutes
        };
        let title = input.title.trim().to_string();
        let body = input.body.trim().to_string();
        Self {
            habit_id: habit_id.to_string(),
            enabled: input.enabled,
            mode,
            interval_minutes,
            times: normalize_times(&input.times),
            days: normalize_days(&input.days),
            title: if title.is_empty() {
                default_reminder_title(habit_name)
            } else {
                title
            },
            body: if body.is_empty() {
                default_reminder_body(habit_name)
            } else {
                body
            },
            skip_if_done: input.skip_if_done,
            last_fired_slot: None,
        }
    }

    pub fn default_for(habit: &Habit, settings: &ReminderSettings) -> Self {
        Self {
            habit_id: habit.id.clone(),
            enabled: true,
            mode: "interval".to_string(),
            interval_minutes: settings.default_interval_minutes,
            times: vec!["09:00".to_string()],
            days: normalize_days(&habit.weekdays),
            title: default_reminder_title(&habit.name),
            body: default_reminder_body(&habit.name),
            skip_if_done: true,
            last_fired_slot: None,
        }
    }

    pub fn render(template: &str, habit: &Habit) -> String {
        template
            .replace("{habit}", &habit.name)
            .replace("{description}", &habit.description)
            .replace("{category}", &habit.category)
            .replace("{target}", &habit.target_per_week.to_string())
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct NotificationStatus {
    pub permission: String,
    pub platform: String,
    pub settings: ReminderSettings,
    pub active_habits: usize,
    pub scheduled_count: usize,
}

#[cfg(test)]
mod tests {
    use super::{default_weekdays, NewHabit};

    fn input(schedule_type: &str, weekdays: Vec<i64>) -> NewHabit {
        NewHabit {
            name: "test".into(),
            description: "".into(),
            icon: "sparkles".into(),
            color: "cyan".into(),
            category: "Test".into(),
            target_per_week: 7,
            schedule_type: schedule_type.into(),
            weekdays,
        }
    }

    #[test]
    fn normalizes_weekday_schedules() {
        assert_eq!(input("weekdays", vec![]).effective_schedule().1, vec![1, 2, 3, 4, 5]);
        assert_eq!(input("weekends", vec![]).effective_schedule().1, vec![6, 7]);
        assert_eq!(input("custom", vec![7, 1, 1, 9]).effective_schedule().1, vec![1, 7]);
        assert_eq!(input("unknown", vec![]).effective_schedule().1, default_weekdays());
    }
}
