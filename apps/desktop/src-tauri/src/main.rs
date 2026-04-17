#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Skitza desktop shell — Phase F.
//
// Activates a stack of Tauri v2 plugins on top of the bare window so
// the web app gets native-feeling affordances when running inside the
// Tauri shell:
//   * `fs`            — read files dropped from Finder (the drag/drop
//                       payload is paths, we turn them into Files in
//                       the frontend bridge).
//   * `notification`  — fire native OS toasts when new inbox items land.
//   * `global-shortcut` — ⌥⌘Space shows the window and opens the palette.
//
// A native menu bar (File / View) is installed, and clicks emit a
// `menu:action` event that the frontend routes to router pushes or
// dispatches to existing custom events (dark mode toggle, sidebar).
//
// NOTE: every shell hook degrades gracefully to the plain web UX —
// frontend code gates desktop-only bridges on `isTauri()`.

use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // ---------- Native menu bar ----------
            let new_deal = MenuItemBuilder::new("New Deal")
                .id("new-deal")
                .accelerator("CmdOrCtrl+N")
                .build(app)?;
            let new_contract = MenuItemBuilder::new("New Contract")
                .id("new-contract")
                .accelerator("CmdOrCtrl+Shift+N")
                .build(app)?;
            let file_menu = SubmenuBuilder::new(app, "File")
                .items(&[&new_deal, &new_contract])
                .build()?;

            let toggle_dark = MenuItemBuilder::new("Toggle Dark Mode")
                .id("toggle-dark")
                .accelerator("CmdOrCtrl+Shift+D")
                .build(app)?;
            let toggle_sidebar = MenuItemBuilder::new("Toggle Sidebar")
                .id("toggle-sidebar")
                .accelerator("CmdOrCtrl+B")
                .build(app)?;
            let view_menu = SubmenuBuilder::new(app, "View")
                .items(&[&toggle_dark, &toggle_sidebar])
                .build()?;

            let menu = MenuBuilder::new(app)
                .items(&[&file_menu, &view_menu])
                .build()?;
            app.set_menu(menu)?;

            app.on_menu_event(move |app_handle, event| {
                if let Some(win) = app_handle.get_webview_window("main") {
                    // The frontend bridge dispatches on the event id.
                    let _ = win.emit("menu:action", event.id().0.clone());
                }
            });

            // ---------- Global shortcut: ⌥⌘Space ----------
            // Works while the app is backgrounded. Pressing reveals the
            // window and tells the palette to open.
            let palette_shortcut =
                Shortcut::new(Some(Modifiers::ALT | Modifiers::SUPER), Code::Space);
            let palette_shortcut_for_handler = palette_shortcut;

            app.handle().plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(move |app_handle, shortcut, event| {
                        if shortcut == &palette_shortcut_for_handler
                            && event.state() == ShortcutState::Pressed
                        {
                            if let Some(win) = app_handle.get_webview_window("main") {
                                let _ = win.show();
                                let _ = win.set_focus();
                                let _ = win.emit("menu:action", "open-palette".to_string());
                            }
                        }
                    })
                    .build(),
            )?;

            app.global_shortcut().register(palette_shortcut)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
