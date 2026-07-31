mod desktop;
mod tray;

use tauri::Manager;

pub fn run() {
    // Tauri's Builder is the native application lifecycle. `setup` runs after
    // Tauri has created the configured windows but before the event loop begins.
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            desktop::hide_main_window,
            desktop::is_behavior_paused,
            desktop::reset_main_window_position,
            desktop::set_main_window_always_on_top,
            desktop::show_main_window,
            tray::report_runtime_failure
        ])
        .setup(|app| {
            // The configured window is created before Tao can override Windows'
            // default minimum tracking width. Reapply the exact logical size now,
            // before the first frame makes the transparent window visible.
            desktop::enforce_main_window_size(app.handle())?;
            // Install the tray before the hidden, taskbar-less pet becomes usable.
            // This guarantees that the user always has a native recovery/quit path.
            tray::install(app)?;
            if let Err(error) = desktop::ensure_main_window_reachable(app.handle()) {
                // A transient monitor-enumeration failure must not take down the
                // recovery tray. The first Show and Reset Position both retry the
                // same reachability policy from the live Windows session.
                tray::report_shell_error(tray::ShellOperation::Reachability, error);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Future auxiliary windows must retain their normal close behavior.
            if window.label() != desktop::MAIN_WINDOW_LABEL {
                return;
            }

            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Closing the pet hides it instead of terminating the process. The
                // tray remains alive and can show the same WebView window again.
                api.prevent_close();

                if let Err(error) = desktop::set_main_window_visibility(window.app_handle(), false)
                {
                    tray::report_shell_error(tray::ShellOperation::Visibility, error);
                }
                return;
            }

            // Physical coordinates can become invalid after a monitor is removed,
            // its work area changes, or the window crosses a mixed-DPI boundary.
            if matches!(
                event,
                tauri::WindowEvent::Moved(_)
                    | tauri::WindowEvent::Resized(_)
                    | tauri::WindowEvent::ScaleFactorChanged { .. }
            ) {
                if let Err(error) = desktop::ensure_main_window_reachable(window.app_handle()) {
                    tray::report_shell_error(tray::ShellOperation::Reachability, error);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run the Phoebo desktop shell");
}
