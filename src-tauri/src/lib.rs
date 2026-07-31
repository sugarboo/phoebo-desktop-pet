mod tray;

pub fn run() {
    // Tauri's Builder is the native application lifecycle. `setup` runs after
    // Tauri has created the configured windows but before the event loop begins.
    tauri::Builder::default()
        .setup(|app| {
            // Install the tray before the hidden, taskbar-less pet becomes usable.
            // This guarantees that the user always has a native recovery/quit path.
            tray::install(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // Future auxiliary windows must retain their normal close behavior.
            if window.label() != tray::MAIN_WINDOW_LABEL {
                return;
            }

            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Closing the pet hides it instead of terminating the process. The
                // tray remains alive and can show the same WebView window again.
                api.prevent_close();

                if let Err(_error) = window.hide() {
                    #[cfg(debug_assertions)]
                    eprintln!("[desktop-shell:close] could not hide the main window: {_error}");
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run the Phoebo desktop shell");
}
