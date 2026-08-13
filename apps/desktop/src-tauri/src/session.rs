use std::{
    sync::Mutex,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::{DesktopState, MAIN_WINDOW_LABEL};

const VALIDATION_LOOP_INTERVAL: Duration = Duration::from_secs(10);
const HIDDEN_VALIDATION_INTERVAL: Duration = Duration::from_secs(45);
const SESSION_VALIDATION_MAX_AGE: Duration = Duration::from_secs(120);
const SUSPEND_GAP: Duration = Duration::from_secs(20);

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SessionValidationStatus {
    Valid,
    Invalid,
    Unknown,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopSessionValidationReport {
    account_matches: bool,
    status: SessionValidationStatus,
    validated_at: Option<f64>,
}

struct AcceptedValidation {
    accepted_at: Instant,
    is_valid: bool,
}

struct SessionInner {
    last_tick: Instant,
    last_request: Option<Instant>,
    last_validation: Option<AcceptedValidation>,
}

pub struct SessionValidationState {
    inner: Mutex<SessionInner>,
}

impl Default for SessionValidationState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(SessionInner {
                last_tick: Instant::now(),
                last_request: None,
                last_validation: None,
            }),
        }
    }
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
enum SessionBridgeEvent {
    SessionValidationRequested,
    RuntimeSuspended,
}

fn deliver(app: &AppHandle, event: SessionBridgeEvent) {
    let Some(state) = app.try_state::<DesktopState>() else {
        return;
    };
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return;
    };
    let Ok(url) = window.url() else {
        return;
    };
    if !state.origin.is_trusted_remote(&url) {
        return;
    }
    let Ok(payload) = serde_json::to_string(&event) else {
        return;
    };
    let _ = window.eval(&format!("window.__SKITZA_DESKTOP_DELIVER__?.({payload});"));
}

impl SessionValidationState {
    pub fn before_reveal(&self, app: &AppHandle) {
        let lock_required = self
            .inner
            .lock()
            .map(|mut inner| {
                let suspended = inner.last_tick.elapsed() >= SUSPEND_GAP;
                inner.last_tick = Instant::now();
                if suspended {
                    inner.last_validation = None;
                }
                suspended
                    || !inner.last_validation.as_ref().is_some_and(|validation| {
                        validation.is_valid
                            && validation.accepted_at.elapsed() <= SESSION_VALIDATION_MAX_AGE
                    })
            })
            .unwrap_or(true);
        if lock_required {
            deliver(app, SessionBridgeEvent::RuntimeSuspended);
        }
        self.request_validation(app);
    }

    pub fn request_validation(&self, app: &AppHandle) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.last_request = Some(Instant::now());
        }
        deliver(app, SessionBridgeEvent::SessionValidationRequested);
    }

    fn tick(&self, app: &AppHandle) {
        let (suspended, request_due) = {
            let Ok(mut inner) = self.inner.lock() else {
                return;
            };
            let now = Instant::now();
            let gap = now.duration_since(inner.last_tick);
            inner.last_tick = now;
            let suspended = gap >= SUSPEND_GAP;
            if suspended {
                inner.last_validation = None;
            }
            let request_due = inner
                .last_request
                .is_none_or(|last_request| last_request.elapsed() >= HIDDEN_VALIDATION_INTERVAL);
            (suspended, request_due)
        };
        if suspended {
            deliver(app, SessionBridgeEvent::RuntimeSuspended);
            self.request_validation(app);
            return;
        }
        let hidden = app
            .get_webview_window(MAIN_WINDOW_LABEL)
            .and_then(|window| window.is_visible().ok())
            == Some(false);
        if hidden && request_due {
            self.request_validation(app);
        }
    }

    fn accept_report(&self, report: &DesktopSessionValidationReport) -> Result<bool, String> {
        let timestamp_valid = report
            .validated_at
            .is_some_and(|value| value.is_finite() && value > 0.0);
        let valid = report.status == SessionValidationStatus::Valid
            && report.account_matches
            && timestamp_valid;
        let malformed_valid = report.status == SessionValidationStatus::Valid && !valid;
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "session-validation-unavailable")?;
        inner.last_validation = Some(AcceptedValidation {
            accepted_at: Instant::now(),
            is_valid: valid,
        });
        if malformed_valid {
            return Err("session-validation-report-invalid".into());
        }
        Ok(valid)
    }
}

pub fn start_validation_loop(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(VALIDATION_LOOP_INTERVAL);
        let Some(state) = app.try_state::<DesktopState>() else {
            break;
        };
        state.session.tick(&app);
    });
}

#[tauri::command]
pub fn report_session_validation(
    report: DesktopSessionValidationReport,
    app: AppHandle,
    state: State<'_, DesktopState>,
) -> Result<(), String> {
    match state.session.accept_report(&report) {
        Ok(true) => Ok(()),
        Ok(false) => {
            deliver(&app, SessionBridgeEvent::RuntimeSuspended);
            Ok(())
        }
        Err(error) => {
            deliver(&app, SessionBridgeEvent::RuntimeSuspended);
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_matching_live_validation_unlocks_warm_content() {
        let state = SessionValidationState::default();
        assert!(state
            .accept_report(&DesktopSessionValidationReport {
                account_matches: true,
                status: SessionValidationStatus::Valid,
                validated_at: Some(1.0),
            })
            .unwrap());
        assert!(!state
            .accept_report(&DesktopSessionValidationReport {
                account_matches: false,
                status: SessionValidationStatus::Invalid,
                validated_at: None,
            })
            .unwrap());
    }

    #[test]
    fn malformed_valid_report_fails_closed() {
        let state = SessionValidationState::default();
        assert!(state
            .accept_report(&DesktopSessionValidationReport {
                account_matches: false,
                status: SessionValidationStatus::Valid,
                validated_at: Some(1.0),
            })
            .is_err());
        assert!(
            !state
                .inner
                .lock()
                .unwrap()
                .last_validation
                .as_ref()
                .unwrap()
                .is_valid
        );
        assert!(state
            .accept_report(&DesktopSessionValidationReport {
                account_matches: true,
                status: SessionValidationStatus::Valid,
                validated_at: None,
            })
            .is_err());
    }

    #[test]
    fn native_hidden_cadence_stays_below_sixty_seconds() {
        assert!(HIDDEN_VALIDATION_INTERVAL + VALIDATION_LOOP_INTERVAL <= Duration::from_secs(55));
        assert!(SUSPEND_GAP <= VALIDATION_LOOP_INTERVAL * 2);
    }
}
