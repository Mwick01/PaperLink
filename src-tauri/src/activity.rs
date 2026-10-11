use serde::Serialize;
use std::{
    collections::VecDeque,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Debug, Clone, Serialize)]
pub struct ActivityEvent {
    pub id: u64,
    pub timestamp_ms: u64,
    pub tool: String,
    pub detail: String,
    pub result: String,
}

#[derive(Clone, Default)]
pub struct ActivityLog {
    events: Arc<Mutex<VecDeque<ActivityEvent>>>,
    next_id: Arc<AtomicU64>,
}

impl ActivityLog {
    pub fn record(
        &self,
        tool: impl Into<String>,
        detail: impl Into<String>,
        result: impl Into<String>,
    ) {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;

        let timestamp_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let event = ActivityEvent {
            id,
            timestamp_ms,
            tool: tool.into(),
            detail: detail.into(),
            result: result.into(),
        };

        if let Ok(mut events) = self.events.lock() {
            events.push_front(event);

            while events.len() > 50 {
                events.pop_back();
            }
        }
    }

    pub fn list(&self) -> Vec<ActivityEvent> {
        self.events
            .lock()
            .map(|events| events.iter().cloned().collect())
            .unwrap_or_default()
    }
}