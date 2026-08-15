#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(feature = "gate1-proof")]
mod access_token;
mod auth;
mod origin;
#[cfg(feature = "gate1-proof")]
mod protection_bypass;
mod session;
mod timing;

use std::time::Duration;

#[cfg(feature = "gate1-proof")]
use access_token::DesktopAccessToken;
use auth::{begin_social_sign_in, handle_deep_link, AuthState};
use origin::OriginPolicy;
#[cfg(feature = "gate1-proof")]
use protection_bypass::{
    protection_cookie_from_redirect, protection_cookie_matches, ProtectionBypass,
};
use session::{report_session_validation, start_validation_loop, SessionValidationState};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_deep_link::DeepLinkExt;
use timing::{consume_reveal_elapsed_ms, export_gate1_samples, record_gate1_sample, TimingState};
use url::Url;
#[cfg(feature = "gate1-proof")]
use zeroize::Zeroizing;

const BRIDGE_PROTOCOL_VERSION: u16 = 1;
const MAIN_WINDOW_LABEL: &str = "main";

struct DesktopState {
    auth: AuthState,
    client: reqwest::Client,
    origin: OriginPolicy,
    #[cfg(feature = "gate1-proof")]
    access_token: Option<DesktopAccessToken>,
    #[cfg(feature = "gate1-proof")]
    protection_bypass: Option<ProtectionBypass>,
    session: SessionValidationState,
    timing: TimingState,
}

#[derive(Clone, Copy)]
struct DesktopDiagnosticsPolicy {
    sensitive_bootstrap_present: bool,
}

impl DesktopDiagnosticsPolicy {
    fn new(protection_bypass_present: bool, access_token_present: bool) -> Self {
        Self {
            sensitive_bootstrap_present: protection_bypass_present || access_token_present,
        }
    }

    fn disable_webview_devtools(self) -> bool {
        self.sensitive_bootstrap_present
    }

    #[cfg(feature = "gate1-proof")]
    fn expose_gate_inspector(self) -> bool {
        !self.sensitive_bootstrap_present
    }
}

#[tauri::command]
async fn retry_launch(window: WebviewWindow, state: State<'_, DesktopState>) -> Result<(), String> {
    let launch_url = state.origin.endpoint("/launch")?;

    #[cfg(feature = "gate1-proof")]
    if let Some(bypass) = state.protection_bypass.as_ref() {
        let response = bypass
            .configure_cookie_request(state.client.get(launch_url.clone()))
            .send()
            .await
            .map_err(|_| "connection-unavailable".to_string())?;
        let cookie = protection_cookie_from_redirect(
            response.status(),
            response.url(),
            response.headers(),
            &launch_url,
            &state.origin,
        )
        .map_err(|_| "connection-unavailable".to_string())?;

        {
            let cookie_name = cookie.name().to_owned();
            let expected_cookie_value = Zeroizing::new(cookie.value().to_owned());
            let expected_cookie_host = launch_url
                .host_str()
                .ok_or_else(|| "connection-unavailable".to_string())?;
            let existing_cookies = window
                .cookies_for_url(launch_url.clone())
                .map_err(|_| "connection-unavailable".to_string())?;
            let mut removed_existing = false;
            for existing in existing_cookies
                .into_iter()
                .filter(|existing| existing.name() == cookie_name)
            {
                window
                    .delete_cookie(existing)
                    .map_err(|_| "connection-unavailable".to_string())?;
                removed_existing = true;
            }
            if removed_existing
                && window
                    .cookies_for_url(launch_url.clone())
                    .map_err(|_| "connection-unavailable".to_string())?
                    .iter()
                    .any(|existing| existing.name() == cookie_name)
            {
                return Err("connection-unavailable".into());
            }
            window
                .set_cookie(cookie)
                .map_err(|_| "connection-unavailable".to_string())?;
            let seeded_cookies = window
                .cookies_for_url(launch_url.clone())
                .map_err(|_| "connection-unavailable".to_string())?;
            let mut matching_cookies = seeded_cookies
                .iter()
                .filter(|stored| stored.name() == cookie_name);
            let stored_cookie = matching_cookies.next();
            let exactly_one = stored_cookie.is_some() && matching_cookies.next().is_none();
            let cookie_matches = stored_cookie.is_some_and(|stored| {
                protection_cookie_matches(
                    stored,
                    expected_cookie_value.as_bytes(),
                    expected_cookie_host,
                )
            });
            if !exactly_one || !cookie_matches {
                return Err("connection-unavailable".into());
            }

            return window
                .navigate(launch_url)
                .map_err(|_| "navigation-failed".to_string());
        }
    }

    let response = state
        .client
        .get(launch_url.clone())
        .send()
        .await
        .map_err(|_| "connection-unavailable".to_string())?;
    if !response.status().is_success() || response.url() != &launch_url {
        return Err("connection-unavailable".into());
    }
    #[cfg(feature = "gate1-proof")]
    if let Some(access_token) = state.access_token.as_ref() {
        access_token
            .seed_cookie(&window, &launch_url, &state.origin)
            .map_err(|_| "connection-unavailable".to_string())?;
    }
    window
        .navigate(launch_url)
        .map_err(|_| "navigation-failed".to_string())
}

fn reveal_main_window(app: &AppHandle) {
    if let Some(state) = app.try_state::<DesktopState>() {
        state.timing.begin_reopen();
        state.session.before_reveal(app);
    }
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.eval("window.__SKITZA_DESKTOP_DELIVER__?.({type:'window-revealed'});");
    }
}

fn create_main_window(
    app: &mut tauri::App,
    origin: OriginPolicy,
    diagnostics: DesktopDiagnosticsPolicy,
) -> tauri::Result<()> {
    let navigation_origin = origin.clone();
    let new_window_origin = origin.clone();
    let trusted_origin =
        serde_json::to_string(origin.as_str()).expect("trusted desktop origin must serialize");
    let initialization_script = format!(
        "Object.defineProperty(window,'__SKITZA_DESKTOP_TRUSTED_ORIGIN__',{{configurable:false,enumerable:false,writable:false,value:{trusted_origin}}});\n{}",
        include_str!("../../assets/bridge.js")
    );
    let window_builder =
        WebviewWindowBuilder::new(app, MAIN_WINDOW_LABEL, WebviewUrl::App("index.html".into()))
            .title("Skitza")
            .inner_size(1280.0, 800.0)
            .min_inner_size(960.0, 600.0)
            .center()
            .initialization_script(initialization_script);
    let window_builder = if diagnostics.disable_webview_devtools() {
        window_builder.devtools(false)
    } else {
        window_builder
    };
    let window = window_builder
        .on_navigation(move |url| {
            if navigation_origin.allows_navigation(url) {
                return true;
            }
            if navigation_origin.is_external_web_url(url) {
                let _ = webbrowser::open(url.as_str());
            }
            false
        })
        .on_new_window(move |url, _features| {
            if new_window_origin.is_trusted_remote(&url)
                || new_window_origin.is_external_web_url(&url)
            {
                let _ = webbrowser::open(url.as_str());
            }
            tauri::webview::NewWindowResponse::Deny
        })
        .build()?;
    window.show()?;
    Ok(())
}

fn create_tray(app: &mut tauri::App, diagnostics: DesktopDiagnosticsPolicy) -> tauri::Result<()> {
    #[cfg(not(feature = "gate1-proof"))]
    let _ = diagnostics;
    let open = MenuItemBuilder::with_id("open-skitza", "Open Skitza").build(app)?;
    #[cfg(feature = "gate1-proof")]
    let inspector = if diagnostics.expose_gate_inspector() {
        Some(MenuItemBuilder::with_id("gate1-inspector", "Gate 1 Web Inspector").build(app)?)
    } else {
        None
    };
    let quit = MenuItemBuilder::with_id("quit-skitza", "Quit Skitza").build(app)?;
    let menu_builder = MenuBuilder::new(app).item(&open);
    #[cfg(feature = "gate1-proof")]
    let menu_builder = match &inspector {
        Some(inspector) => menu_builder.item(inspector),
        None => menu_builder,
    };
    let menu = menu_builder.item(&quit).build()?;

    #[cfg(target_os = "macos")]
    let icon = tauri::include_image!("icons/tray-template.png");
    #[cfg(not(target_os = "macos"))]
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| tauri::Error::AssetNotFound("Skitza app icon".into()))?;
    let builder = TrayIconBuilder::new()
        .icon(icon)
        .tooltip("Skitza")
        .menu(&menu)
        .show_menu_on_left_click(false);
    #[cfg(target_os = "macos")]
    let builder = builder.icon_as_template(true);
    let builder = builder
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "open-skitza" => reveal_main_window(app),
            #[cfg(feature = "gate1-proof")]
            "gate1-inspector" if diagnostics.expose_gate_inspector() => {
                reveal_main_window(app);
                if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                    window.open_devtools();
                }
            }
            "quit-skitza" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                reveal_main_window(tray.app_handle());
            }
        });

    builder.build(app)?;
    Ok(())
}

fn dispatch_callback_url(app: AppHandle, url: Url) {
    if url.scheme() != "skitza" {
        return;
    }
    let Some(state) = app.try_state::<DesktopState>() else {
        return;
    };
    if !state.auth.accept_callback_dispatch(&url) {
        return;
    }
    drop(state);
    tauri::async_runtime::spawn(async move {
        handle_deep_link(&app, url).await;
    });
}

fn handle_callback_argument(app: AppHandle, value: &str) {
    let Ok(url) = Url::parse(value) else {
        return;
    };
    dispatch_callback_url(app, url);
}

fn main() {
    let origin = OriginPolicy::compile_time();
    #[cfg(feature = "gate1-proof")]
    let protection_bypass = ProtectionBypass::from_env(&origin)
        .expect("invalid Gate 1 protection bypass configuration");
    #[cfg(feature = "gate1-proof")]
    let access_token = DesktopAccessToken::from_env(&origin, protection_bypass.is_some())
        .expect("invalid desktop access token configuration");
    #[cfg(feature = "gate1-proof")]
    let diagnostics =
        DesktopDiagnosticsPolicy::new(protection_bypass.is_some(), access_token.is_some());
    #[cfg(not(feature = "gate1-proof"))]
    let diagnostics = DesktopDiagnosticsPolicy::new(false, false);
    let client_builder = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(12))
        .user_agent("Skitza-Gate1-Desktop/0.1");
    #[cfg(feature = "gate1-proof")]
    let client_builder = match protection_bypass.as_ref() {
        Some(bypass) => bypass.configure_client(client_builder),
        None => client_builder,
    };
    let client = client_builder
        .build()
        .expect("failed to build the HTTPS client");

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            for argument in args {
                handle_callback_argument(app.clone(), &argument);
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .manage(DesktopState {
            auth: AuthState::default(),
            client,
            origin: origin.clone(),
            #[cfg(feature = "gate1-proof")]
            access_token,
            #[cfg(feature = "gate1-proof")]
            protection_bypass,
            session: SessionValidationState::default(),
            timing: TimingState::default(),
        })
        .invoke_handler(tauri::generate_handler![
            retry_launch,
            begin_social_sign_in,
            record_gate1_sample,
            consume_reveal_elapsed_ms,
            export_gate1_samples,
            report_session_validation,
        ])
        .setup(move |app| {
            create_main_window(app, origin.clone(), diagnostics)?;
            create_tray(app, diagnostics)?;
            start_validation_loop(app.handle().clone());

            #[cfg(any(target_os = "linux", windows))]
            app.deep_link().register("skitza")?;

            let app_handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    dispatch_callback_url(app_handle.clone(), url.clone());
                }
            });

            for argument in std::env::args().skip(1) {
                handle_callback_argument(app.handle().clone(), &argument);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == MAIN_WINDOW_LABEL {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                    if let Some(state) = window.app_handle().try_state::<DesktopState>() {
                        state.session.request_validation(window.app_handle());
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("Skitza desktop failed to run");
}

#[cfg(test)]
mod tests {
    use super::DesktopDiagnosticsPolicy;

    #[test]
    fn protected_runtime_disables_webview_inspection() {
        let diagnostics = DesktopDiagnosticsPolicy::new(true, false);

        assert!(diagnostics.disable_webview_devtools());
        #[cfg(feature = "gate1-proof")]
        assert!(!diagnostics.expose_gate_inspector());
    }

    #[cfg(feature = "gate1-proof")]
    #[test]
    fn access_token_bootstrap_disables_webview_inspection() {
        let diagnostics = DesktopDiagnosticsPolicy::new(false, true);

        assert!(diagnostics.disable_webview_devtools());
        assert!(!diagnostics.expose_gate_inspector());
    }

    #[cfg(feature = "gate1-proof")]
    #[test]
    fn absent_env_relaunch_restores_gate_inspector() {
        let diagnostics = DesktopDiagnosticsPolicy::new(false, false);

        assert!(!diagnostics.disable_webview_devtools());
        assert!(diagnostics.expose_gate_inspector());
    }
}
