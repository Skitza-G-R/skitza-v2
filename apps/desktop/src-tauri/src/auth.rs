use std::{
    sync::Mutex,
    time::{Duration, Instant},
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use tauri::{AppHandle, Manager, State, WebviewWindow};
use url::Url;
use zeroize::Zeroize;

use crate::{DesktopState, MAIN_WINDOW_LABEL};

const AUTH_LIFETIME: Duration = Duration::from_secs(60);
const CALLBACK_DEDUPE_WINDOW: Duration = Duration::from_secs(5);
const MAX_EXCHANGE_BODY_LENGTH: usize = 4_608;
const MAX_TICKET_LENGTH: usize = 4_096;

#[derive(Default)]
pub struct AuthState {
    attempt: Mutex<Option<AuthAttempt>>,
    recent_callback: Mutex<Option<RecentCallback>>,
}

struct RecentCallback {
    fingerprint: [u8; 32],
    seen_at: Instant,
}

impl Drop for RecentCallback {
    fn drop(&mut self) {
        self.fingerprint.zeroize();
    }
}

struct AuthAttempt {
    state: String,
    verifier: String,
    created_at: Instant,
}

impl Drop for AuthAttempt {
    fn drop(&mut self) {
        self.state.zeroize();
        self.verifier.zeroize();
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ExchangeResponse {
    #[serde(rename = "protocolVersion")]
    protocol_version: u16,
    ticket: String,
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
enum BridgeEvent<'a> {
    SocialSignInTicket { ticket: &'a str },
    SocialSignInError { code: &'a str },
}

fn random_url_safe(bytes: usize) -> String {
    let mut value = vec![0_u8; bytes];
    rand::rng().fill_bytes(&mut value);
    let encoded = URL_SAFE_NO_PAD.encode(&value);
    value.zeroize();
    encoded
}

fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

impl AuthState {
    pub fn accept_callback_dispatch(&self, url: &Url) -> bool {
        let fingerprint: [u8; 32] = Sha256::digest(url.as_str().as_bytes()).into();
        let Ok(mut recent) = self.recent_callback.lock() else {
            return false;
        };
        let duplicate = recent.as_ref().is_some_and(|previous| {
            previous.seen_at.elapsed() <= CALLBACK_DEDUPE_WINDOW
                && bool::from(previous.fingerprint.ct_eq(&fingerprint))
        });
        if duplicate {
            return false;
        }
        *recent = Some(RecentCallback {
            fingerprint,
            seen_at: Instant::now(),
        });
        true
    }
}

fn authorization_url(
    origin: &crate::origin::OriginPolicy,
    attempt: &AuthAttempt,
) -> Result<Url, String> {
    let mut url = origin.endpoint("/api/desktop/auth/start")?;
    url.query_pairs_mut()
        .append_pair("state", &attempt.state)
        .append_pair("code_challenge", &pkce_challenge(&attempt.verifier))
        .append_pair("code_challenge_method", "S256");
    Ok(url)
}

#[tauri::command]
pub fn begin_social_sign_in(
    provider: String,
    state: State<'_, DesktopState>,
) -> Result<(), String> {
    if provider != "google" {
        return Err("social-provider-unsupported".into());
    }
    let attempt = AuthAttempt {
        state: random_url_safe(32),
        verifier: random_url_safe(32),
        created_at: Instant::now(),
    };
    let url = authorization_url(&state.origin, &attempt)?;
    {
        let mut slot = state
            .auth
            .attempt
            .lock()
            .map_err(|_| "auth-state-unavailable")?;
        *slot = Some(attempt);
    }
    if webbrowser::open(url.as_str()).is_err() {
        if let Ok(mut slot) = state.auth.attempt.lock() {
            slot.take();
        }
        return Err("browser-open-failed".into());
    }
    Ok(())
}

fn callback_values(url: &Url) -> Result<(String, String), &'static str> {
    if url.scheme() != "skitza"
        || url.host_str() != Some("auth")
        || url.path() != "/callback"
        || url.username() != ""
        || url.password().is_some()
        || url.fragment().is_some()
        || url.query().is_some_and(|query| query.contains('%'))
    {
        return Err("callback-invalid");
    }
    let mut code = None;
    let mut state = None;
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "code" if code.is_none() => code = Some(value.into_owned()),
            "state" if state.is_none() => state = Some(value.into_owned()),
            _ => return Err("callback-invalid"),
        }
    }
    let code = code
        .filter(|value| is_exact_auth_value(value))
        .ok_or("callback-invalid")?;
    let state = state
        .filter(|value| is_exact_auth_value(value))
        .ok_or("callback-invalid")?;
    Ok((code, state))
}

fn is_exact_auth_value(value: &str) -> bool {
    value.len() == 43
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn consume_attempt(auth: &AuthState, callback_state: &str) -> Result<AuthAttempt, &'static str> {
    if !is_exact_auth_value(callback_state) {
        return Err("auth-state-invalid");
    }
    let mut slot = auth.attempt.lock().map_err(|_| "auth-state-unavailable")?;
    let matches = slot
        .as_ref()
        .map(|attempt| {
            attempt
                .state
                .as_bytes()
                .ct_eq(callback_state.as_bytes())
                .into()
                && attempt.created_at.elapsed() <= AUTH_LIFETIME
        })
        .unwrap_or(false);
    if !matches {
        return Err("auth-state-invalid");
    }
    slot.take().ok_or("auth-state-invalid")
}

async fn exchange_code(
    state: &DesktopState,
    code: &str,
    verifier: &str,
) -> Result<String, &'static str> {
    let url = state
        .origin
        .endpoint("/api/desktop/auth/exchange")
        .map_err(|_| "exchange-failed")?;
    let response = state
        .client
        .post(url.clone())
        .json(&serde_json::json!({
            "code": code,
            "codeVerifier": verifier,
        }))
        .send()
        .await
        .map_err(|_| "exchange-failed")?;
    if !response.status().is_success() || response.url() != &url {
        return Err("exchange-failed");
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    if !content_type
        .split(';')
        .next()
        .is_some_and(|value| value.trim().eq_ignore_ascii_case("application/json"))
    {
        return Err("exchange-failed");
    }
    let cache_control = response
        .headers()
        .get_all(reqwest::header::CACHE_CONTROL)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(','))
        .any(|directive| directive.trim().eq_ignore_ascii_case("no-store"));
    if !cache_control {
        return Err("exchange-failed");
    }
    let mut body = response
        .bytes()
        .await
        .map_err(|_| "exchange-failed")?
        .to_vec();
    if body.len() > MAX_EXCHANGE_BODY_LENGTH {
        body.zeroize();
        return Err("exchange-failed");
    }
    let parsed = serde_json::from_slice(&body);
    body.zeroize();
    let mut payload: ExchangeResponse = parsed.map_err(|_| "exchange-failed")?;
    if payload.protocol_version != 1
        || payload.ticket.is_empty()
        || payload.ticket.len() > MAX_TICKET_LENGTH
    {
        payload.ticket.zeroize();
        return Err("exchange-failed");
    }
    Ok(payload.ticket)
}

fn trusted_window(app: &AppHandle, state: &DesktopState) -> Result<WebviewWindow, &'static str> {
    let window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or("webview-unavailable")?;
    let current = window.url().map_err(|_| "webview-unavailable")?;
    if !state.origin.is_trusted_remote(&current) {
        return Err("webview-untrusted");
    }
    Ok(window)
}

fn dispatch_error(app: &AppHandle, code: &'static str) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return;
    };
    let Ok(payload) = serde_json::to_string(&BridgeEvent::SocialSignInError { code }) else {
        return;
    };
    let _ = window.eval(&format!("window.__SKITZA_DESKTOP_DELIVER__?.({payload});"));
}

pub async fn handle_deep_link(app: &AppHandle, url: Url) {
    let state = app.state::<DesktopState>();
    let (mut code, callback_state) = match callback_values(&url) {
        Ok(values) => values,
        Err(error) => {
            dispatch_error(app, error);
            return;
        }
    };
    let mut attempt = match consume_attempt(&state.auth, &callback_state) {
        Ok(attempt) => attempt,
        Err(error) => {
            code.zeroize();
            dispatch_error(app, error);
            return;
        }
    };
    let mut ticket = match exchange_code(&state, &code, &attempt.verifier).await {
        Ok(ticket) => ticket,
        Err(error) => {
            code.zeroize();
            dispatch_error(app, error);
            return;
        }
    };
    code.zeroize();
    attempt.verifier.zeroize();

    let window = match trusted_window(app, &state) {
        Ok(window) => window,
        Err(error) => {
            ticket.zeroize();
            dispatch_error(app, error);
            return;
        }
    };
    let mut payload =
        match serde_json::to_string(&BridgeEvent::SocialSignInTicket { ticket: &ticket }) {
            Ok(payload) => payload,
            Err(_) => {
                ticket.zeroize();
                dispatch_error(app, "ticket-delivery-failed");
                return;
            }
        };
    let mut script = format!("window.__SKITZA_DESKTOP_DELIVER__?.({payload});");
    if window.eval(&script).is_err() {
        dispatch_error(app, "ticket-delivery-failed");
    }
    script.zeroize();
    payload.zeroize();
    ticket.zeroize();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::origin::OriginPolicy;

    #[test]
    fn pkce_url_never_contains_verifier() {
        let verifier = "v".repeat(43);
        let attempt = AuthAttempt {
            state: "state-value".into(),
            verifier: verifier.clone(),
            created_at: Instant::now(),
        };
        let url = authorization_url(
            &OriginPolicy::parse("https://proof.example").unwrap(),
            &attempt,
        )
        .unwrap();
        assert_eq!(url.origin().ascii_serialization(), "https://proof.example");
        assert!(url.as_str().contains("code_challenge_method=S256"));
        assert!(!url.as_str().contains("redirect_uri"));
        assert!(!url.as_str().contains(&verifier));
    }

    #[test]
    fn generated_state_verifier_and_challenge_are_exact_base64url() {
        let state = random_url_safe(32);
        let verifier = random_url_safe(32);
        let challenge = pkce_challenge(&verifier);
        assert!(is_exact_auth_value(&state));
        assert!(is_exact_auth_value(&verifier));
        assert!(is_exact_auth_value(&challenge));
    }

    #[test]
    fn callback_accepts_only_code_and_state_on_exact_route() {
        let (code, state) = callback_values(
            &Url::parse(&format!(
                "skitza://auth/callback?code={}&state={}",
                "a".repeat(43),
                "B".repeat(43)
            ))
            .unwrap(),
        )
        .unwrap();
        assert_eq!(code, "a".repeat(43));
        assert_eq!(state, "B".repeat(43));

        for invalid in [
            "skitza://other/callback?code=x&state=y",
            "skitza://auth/other?code=x&state=y",
            "skitza://auth/callback?ticket=secret&state=y",
            "skitza://auth/callback?code=x&state=y&extra=no",
            "skitza://auth/callback?code=x&code=y&state=z",
            "skitza://auth/callback?code=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&state=%42BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        ] {
            assert!(callback_values(&Url::parse(invalid).unwrap()).is_err());
        }
    }

    #[test]
    fn state_is_single_use_and_constant_time_checked() {
        let auth = AuthState::default();
        *auth.attempt.lock().unwrap() = Some(AuthAttempt {
            state: "e".repeat(43),
            verifier: "v".repeat(43),
            created_at: Instant::now(),
        });
        assert!(consume_attempt(&auth, &"w".repeat(43)).is_err());
        assert!(consume_attempt(&auth, &"e".repeat(43)).is_ok());
        assert!(consume_attempt(&auth, &"e".repeat(43)).is_err());
    }

    #[test]
    fn duplicate_os_callback_dispatch_is_suppressed() {
        let auth = AuthState::default();
        let first = Url::parse(&format!(
            "skitza://auth/callback?code={}&state={}",
            "a".repeat(43),
            "B".repeat(43)
        ))
        .unwrap();
        let different = Url::parse(&format!(
            "skitza://auth/callback?code={}&state={}",
            "c".repeat(43),
            "D".repeat(43)
        ))
        .unwrap();
        assert!(auth.accept_callback_dispatch(&first));
        assert!(!auth.accept_callback_dispatch(&first));
        assert!(auth.accept_callback_dispatch(&different));
    }
}
