#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod auth;
mod origin;
mod session;
mod timing;

use std::time::Duration;

use auth::{begin_social_sign_in, handle_deep_link, AuthState};
use origin::OriginPolicy;
use session::{report_session_validation, start_validation_loop, SessionValidationState};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_deep_link::DeepLinkExt;
use timing::{consume_reveal_elapsed_ms, export_gate1_samples, record_gate1_sample, TimingState};
use url::Url;

const BRIDGE_PROTOCOL_VERSION: u16 = 1;
const MAIN_WINDOW_LABEL: &str = "main";

struct DesktopState {
    auth: AuthState,
    client: reqwest::Client,
    origin: OriginPolicy,
    session: SessionValidationState,
    timing: TimingState,
}

#[tauri::command]
async fn retry_launch(window: WebviewWindow, state: State<'_, DesktopState>) -> Result<(), String> {
    let launch_url = state.origin.endpoint("/launch")?;
    let response = state
        .client
        .get(launch_url.clone())
        .send()
        .await
        .map_err(|_| "connection-unavailable".to_string())?;
    if !response.status().is_success() || response.url() != &launch_url {
        return Err("connection-unavailable".into());
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

fn create_main_window(app: &mut tauri::App, origin: OriginPolicy) -> tauri::Result<()> {
    let navigation_origin = origin.clone();
    let new_window_origin = origin.clone();
    let trusted_origin =
        serde_json::to_string(origin.as_str()).expect("trusted desktop origin must serialize");
    let initialization_script = format!(
        "Object.defineProperty(window,'__SKITZA_DESKTOP_TRUSTED_ORIGIN__',{{configurable:false,enumerable:false,writable:false,value:{trusted_origin}}});\n{}",
        include_str!("../../assets/bridge.js")
    );
    let window =
        WebviewWindowBuilder::new(app, MAIN_WINDOW_LABEL, WebviewUrl::App("index.html".into()))
            .title("Skitza")
            .inner_size(1280.0, 800.0)
            .min_inner_size(960.0, 600.0)
            .center()
            .initialization_script(initialization_script)
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

fn create_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let open = MenuItemBuilder::with_id("open-skitza", "Open Skitza").build(app)?;
    #[cfg(feature = "gate1-proof")]
    let inspector =
        MenuItemBuilder::with_id("gate1-inspector", "Gate 1 Web Inspector").build(app)?;
    let quit = MenuItemBuilder::with_id("quit-skitza", "Quit Skitza").build(app)?;
    let mut menu_builder = MenuBuilder::new(app).item(&open);
    #[cfg(feature = "gate1-proof")]
    {
        menu_builder = menu_builder.item(&inspector);
    }
    let menu = menu_builder.item(&quit).build()?;

    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| tauri::Error::AssetNotFound("Skitza app icon".into()))?;
    let builder = TrayIconBuilder::new()
        .icon(icon)
        .tooltip("Skitza")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open-skitza" => reveal_main_window(app),
            #[cfg(feature = "gate1-proof")]
            "gate1-inspector" => {
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
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(12))
        .user_agent("Skitza-Gate1-Desktop/0.1")
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
            create_main_window(app, origin.clone())?;
            create_tray(app)?;
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
