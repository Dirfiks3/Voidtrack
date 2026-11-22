use std::sync::OnceLock;

use nucleo_matcher::{Matcher, Utf32Str};

use crate::models::{CatalogItem, Suggestion};

static CATALOG: OnceLock<Vec<CatalogItem>> = OnceLock::new();

fn catalog() -> &'static Vec<CatalogItem> {
    CATALOG.get_or_init(|| {
        match serde_json::from_str::<Vec<CatalogItem>>(include_str!("../../shared/catalog.json")) {
            Ok(items) => items,
            Err(error) => {
                // Битой каталог не должен ронять запуск: отдаём пустой список.
                eprintln!("[VoidTrack] не удалось разобрать каталог привычек: {error}");
                Vec::new()
            }
        }
    })
}

fn normalize(value: &str) -> String {
    value.to_lowercase().replace('ё', "е").trim().to_string()
}

/// nucleo fuzzy score + бонусы за точное совпадение/префикс/подстроку.
fn field_score(matcher: &mut Matcher, text: &str, query: &str, weight: f64) -> f64 {
    if query.is_empty() {
        return 0.0;
    }
    let source = normalize(text);
    let needle = normalize(query);
    if source.is_empty() {
        return 0.0;
    }

    let mut haystack_buffer = Vec::with_capacity(source.chars().count());
    let mut needle_buffer = Vec::with_capacity(needle.chars().count());
    let haystack = Utf32Str::new(&source, &mut haystack_buffer);
    let pattern = Utf32Str::new(&needle, &mut needle_buffer);
    let fuzzy = matcher.fuzzy_match(haystack, pattern).unwrap_or(0) as f64;

    let bonus = if source == needle {
        120.0
    } else if source.starts_with(&needle) {
        55.0
    } else if source.contains(&needle) {
        28.0
    } else {
        0.0
    };
    (fuzzy + bonus) * weight
}

pub fn suggest(query: &str, limit: usize) -> Vec<Suggestion> {
    let trimmed = query.trim();

    if trimmed.is_empty() {
        let mut indexed: Vec<(usize, &CatalogItem)> = catalog().iter().enumerate().collect();
        indexed.sort_by(|(left_index, left), (right_index, right)| {
            right
                .popular
                .cmp(&left.popular)
                .then(left_index.cmp(right_index))
        });
        return indexed
            .into_iter()
            .take(limit)
            .map(|(_, item)| Suggestion {
                name: item.name.clone(),
                description: item.description.clone(),
                icon: item.icon.clone(),
                color: item.color.clone(),
                category: item.category.clone(),
                score: 100.0,
            })
            .collect();
    }

    let mut matcher = Matcher::default();
    let mut results: Vec<Suggestion> = catalog()
        .iter()
        .map(|item| {
            let score = field_score(&mut matcher, &item.name, trimmed, 1.8)
                .max(
                    item.keywords
                        .iter()
                        .map(|keyword| field_score(&mut matcher, keyword, trimmed, 1.35))
                        .fold(0.0, f64::max),
                )
                .max(field_score(&mut matcher, &item.category, trimmed, 0.65))
                .max(field_score(&mut matcher, &item.description, trimmed, 0.32))
                + if item.popular { 12.0 } else { 0.0 };
            Suggestion {
                name: item.name.clone(),
                description: item.description.clone(),
                icon: item.icon.clone(),
                color: item.color.clone(),
                category: item.category.clone(),
                score,
            }
        })
        .filter(|item| item.score > 45.0)
        .collect();

    results.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.name.cmp(&b.name))
    });
    results.truncate(limit);
    results
}

#[cfg(test)]
mod tests {
    use super::{catalog, suggest};

    #[test]
    fn catalog_is_large_and_diverse() {
        let items = catalog();
        assert!(items.len() >= 120, "expected 120+ habits, got {}", items.len());
        assert!(items.iter().all(|item| !item.keywords.is_empty()));
        assert!(items.iter().any(|item| item.popular));
    }

    #[test]
    fn finds_by_synonym() {
        let result = suggest("спорт", 3);
        assert!(result.iter().any(|item| item.name == "Тренировка"));
    }

    #[test]
    fn finds_by_partial_name() {
        let result = suggest("медит", 3);
        assert!(result.first().is_some_and(|item| item.name == "Утренняя медитация"));
    }

    #[test]
    fn finds_english_and_fuzzy() {
        assert!(suggest("meditat", 3).iter().any(|item| item.name == "Утренняя медитация"));
        assert!(suggest("вод", 5).iter().any(|item| item.name == "Пить 2 литра воды"));
    }

    #[test]
    fn empty_query_returns_popular() {
        let result = suggest("", 5);
        assert_eq!(result.len(), 5);
        assert!(result.iter().all(|item| item.score > 0.0));
    }
}
