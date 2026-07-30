use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    App, AppHandle, Manager,
};

pub const MAIN_WINDOW_LABEL: &str = "main";

const TRAY_ID: &str = "phoebo-tray";
const MENU_SHOW_ID: &str = "pet-show";
const MENU_HIDE_ID: &str = "pet-hide";
const MENU_QUIT_ID: &str = "app-quit";
const TRAY_ICON_SIZE: u32 = 32;

static SHELL_ERROR_REPORTED: AtomicBool = AtomicBool::new(false);

pub fn install(app: &mut App) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, MENU_SHOW_ID, "Show", true, None::<&str>)?;
    let hide_item = MenuItem::with_id(app, MENU_HIDE_ID, "Hide", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, MENU_QUIT_ID, "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &hide_item, &quit_item])?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(placeholder_tray_icon())
        .tooltip("Phoebo")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            MENU_SHOW_ID => set_main_window_visibility(app, true),
            MENU_HIDE_ID => set_main_window_visibility(app, false),
            MENU_QUIT_ID => app.exit(0),
            _ => {}
        })
        .build(app)?;

    Ok(())
}

fn set_main_window_visibility(app: &AppHandle, visible: bool) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        report_shell_error("main window is unavailable");
        return;
    };

    let result = if visible {
        window.show()
    } else {
        window.hide()
    };

    if let Err(error) = result {
        let operation = if visible { "show" } else { "hide" };
        report_shell_error(format!("could not {operation} the main window: {error}"));
    }
}

fn report_shell_error(message: impl std::fmt::Display) {
    if !SHELL_ERROR_REPORTED.swap(true, Ordering::Relaxed) {
        eprintln!("[desktop-shell] {message}");
    }
}

fn placeholder_tray_icon() -> Image<'static> {
    let mut rgba = vec![0_u8; (TRAY_ICON_SIZE * TRAY_ICON_SIZE * 4) as usize];

    for y in 0..TRAY_ICON_SIZE {
        for x in 0..TRAY_ICON_SIZE {
            let x = x as i32;
            let y = y as i32;
            let head = inside_circle(x, y, 16, 18, 11);
            let left_ear = (5..=14).contains(&y) && x >= 5 && x <= y + 3;
            let right_ear = (5..=14).contains(&y) && x <= 27 && x >= 29 - y;

            if head || left_ear || right_ear {
                set_pixel(&mut rgba, x, y, [55, 198, 208, 255]);
            }

            let left_eye = inside_circle(x, y, 12, 17, 1);
            let right_eye = inside_circle(x, y, 20, 17, 1);

            if left_eye || right_eye {
                set_pixel(&mut rgba, x, y, [21, 52, 66, 255]);
            }
        }
    }

    Image::new_owned(rgba, TRAY_ICON_SIZE, TRAY_ICON_SIZE)
}

fn inside_circle(x: i32, y: i32, center_x: i32, center_y: i32, radius: i32) -> bool {
    let delta_x = x - center_x;
    let delta_y = y - center_y;
    delta_x * delta_x + delta_y * delta_y <= radius * radius
}

fn set_pixel(rgba: &mut [u8], x: i32, y: i32, color: [u8; 4]) {
    let pixel_index = ((y as u32 * TRAY_ICON_SIZE + x as u32) * 4) as usize;
    rgba[pixel_index..pixel_index + 4].copy_from_slice(&color);
}

#[cfg(test)]
mod tests {
    use super::{placeholder_tray_icon, TRAY_ICON_SIZE};

    #[test]
    fn placeholder_icon_has_transparency_and_visible_pixels() {
        let icon = placeholder_tray_icon();
        let alpha_values = icon.rgba().chunks_exact(4).map(|pixel| pixel[3]);

        assert_eq!(icon.width(), TRAY_ICON_SIZE);
        assert_eq!(icon.height(), TRAY_ICON_SIZE);
        assert!(alpha_values.clone().any(|alpha| alpha == 0));
        assert!(alpha_values.clone().any(|alpha| alpha == 255));
    }
}
