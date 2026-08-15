use std::{sync::Mutex, time::Instant};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{DesktopState, BRIDGE_PROTOCOL_VERSION};

const MAX_DURATION_MS: f64 = 60_000.0;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Gate1Journey {
    ReopenToday,
    SafeClientsProjects,
    CachedRecentAudio,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Gate1Phase {
    Warmup,
    Timed,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Gate1Platform {
    Macos,
    Windows,
    Unknown,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Gate1Runtime {
    Chrome,
    Desktop,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Gate1Source {
    RecentCache,
    Network,
    Resume,
    SafeView,
    Server,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopGate1Sample {
    pub blank_or_fullscreen_spinner: bool,
    pub bridge_protocol_version: Option<u16>,
    pub build_id: String,
    pub duration_ms: f64,
    pub journey: Gate1Journey,
    pub meaningful: bool,
    pub media_download_requests: u32,
    pub origin: String,
    pub phase: Gate1Phase,
    pub platform: Gate1Platform,
    pub run: u8,
    pub runtime: Gate1Runtime,
    pub source: Option<Gate1Source>,
}

impl DesktopGate1Sample {
    fn validate(&self, trusted_origin: &str) -> Result<(), String> {
        let expected_run = match self.phase {
            Gate1Phase::Warmup => 0,
            Gate1Phase::Timed => self.run,
        };
        if self.run != expected_run
            || (self.phase == Gate1Phase::Timed && !(1..=5).contains(&self.run))
            || !self.duration_ms.is_finite()
            || !(0.0..=MAX_DURATION_MS).contains(&self.duration_ms)
            || self.bridge_protocol_version != Some(BRIDGE_PROTOCOL_VERSION)
            || self.origin != trusted_origin
            || self.runtime != Gate1Runtime::Desktop
            || self.platform != current_platform()
            || self.build_id.is_empty()
            || self.build_id.len() > 128
            || self.build_id.chars().any(char::is_control)
        {
            return Err("gate1-sample-invalid".into());
        }

        Ok(())
    }
}

#[cfg(target_os = "macos")]
fn current_platform() -> Gate1Platform {
    Gate1Platform::Macos
}

#[cfg(target_os = "windows")]
fn current_platform() -> Gate1Platform {
    Gate1Platform::Windows
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn current_platform() -> Gate1Platform {
    Gate1Platform::Unknown
}

#[derive(Default)]
pub struct TimingState {
    records: Mutex<Vec<DesktopGate1Sample>>,
    reopen_started: Mutex<Option<Instant>>,
}

impl TimingState {
    pub fn begin_reopen(&self) {
        if cfg!(debug_assertions) {
            return;
        }
        if let Ok(mut started) = self.reopen_started.lock() {
            *started = Some(Instant::now());
        }
    }

    fn insert(&self, sample: DesktopGate1Sample, trusted_origin: &str) -> Result<(), String> {
        sample.validate(trusted_origin)?;
        let mut records = self
            .records
            .lock()
            .map_err(|_| "gate1-samples-unavailable")?;
        if records.iter().any(|existing| {
            existing.journey == sample.journey
                && existing.phase == sample.phase
                && existing.run == sample.run
                && existing.runtime == sample.runtime
        }) {
            return Err("gate1-sample-already-recorded".into());
        }
        records.push(sample);
        Ok(())
    }
}

fn release_only() -> Result<(), String> {
    if cfg!(debug_assertions) {
        Err("gate1-timing-requires-release-build".into())
    } else {
        Ok(())
    }
}

#[tauri::command]
pub fn consume_reveal_elapsed_ms(state: State<'_, DesktopState>) -> Result<Option<f64>, String> {
    release_only()?;
    let Some(started) = state
        .timing
        .reopen_started
        .lock()
        .map_err(|_| "gate1-samples-unavailable")?
        .take()
    else {
        return Ok(None);
    };
    Ok(Some(started.elapsed().as_secs_f64() * 1_000.0))
}

#[tauri::command]
pub fn record_gate1_sample(
    sample: DesktopGate1Sample,
    state: State<'_, DesktopState>,
) -> Result<(), String> {
    release_only()?;
    state.timing.insert(sample, state.origin.as_str())
}

#[tauri::command]
pub fn export_gate1_samples(
    state: State<'_, DesktopState>,
) -> Result<Vec<DesktopGate1Sample>, String> {
    release_only()?;
    state
        .timing
        .records
        .lock()
        .map_err(|_| "gate1-samples-unavailable".to_string())
        .map(|records| records.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_sample(journey: Gate1Journey) -> DesktopGate1Sample {
        DesktopGate1Sample {
            blank_or_fullscreen_spinner: false,
            bridge_protocol_version: Some(1),
            build_id: "gate1-build".into(),
            duration_ms: 250.5,
            journey,
            meaningful: true,
            media_download_requests: 0,
            origin: "https://proof.example".into(),
            phase: Gate1Phase::Timed,
            platform: current_platform(),
            run: 1,
            runtime: Gate1Runtime::Desktop,
            source: Some(Gate1Source::SafeView),
        }
    }

    #[test]
    fn schema_accepts_only_canonical_runs_and_origin() {
        let valid = valid_sample(Gate1Journey::SafeClientsProjects);
        assert!(valid.validate("https://proof.example").is_ok());
        assert!(DesktopGate1Sample {
            run: 6,
            ..valid.clone()
        }
        .validate("https://proof.example")
        .is_err());
        assert!(DesktopGate1Sample {
            origin: "https://other.example".into(),
            ..valid
        }
        .validate("https://proof.example")
        .is_err());
    }

    #[test]
    fn failed_audio_evidence_is_preserved_for_the_evaluator() {
        let mut sample = valid_sample(Gate1Journey::CachedRecentAudio);
        sample.source = Some(Gate1Source::RecentCache);
        assert!(sample.validate("https://proof.example").is_ok());
        sample.media_download_requests = 1;
        sample.meaningful = false;
        assert!(sample.validate("https://proof.example").is_ok());
    }

    #[test]
    fn duplicate_raw_result_is_rejected() {
        let state = TimingState::default();
        let first = valid_sample(Gate1Journey::SafeClientsProjects);
        state
            .insert(first.clone(), "https://proof.example")
            .unwrap();
        assert!(state
            .insert(
                DesktopGate1Sample {
                    duration_ms: 100.0,
                    source: Some(Gate1Source::Server),
                    ..first
                },
                "https://proof.example"
            )
            .is_err());
        let records = state.records.lock().unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].duration_ms, 250.5);
    }
}
