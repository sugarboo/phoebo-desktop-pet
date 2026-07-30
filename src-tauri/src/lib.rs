mod tray;

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            tray::install(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != tray::MAIN_WINDOW_LABEL {
                return;
            }

            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
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
