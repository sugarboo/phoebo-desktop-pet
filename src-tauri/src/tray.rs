use std::sync::atomic::{AtomicU8, Ordering};

use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    App, AppHandle,
};

use crate::desktop;

const TRAY_ID: &str = "phoebo-tray";
const MENU_SHOW_ID: &str = "pet-show";
const MENU_HIDE_ID: &str = "pet-hide";
const MENU_PAUSE_ID: &str = "behavior-pause";
const MENU_RESET_POSITION_ID: &str = "position-reset";
const MENU_ALWAYS_ON_TOP_ID: &str = "always-on-top-toggle";
const MENU_QUIT_ID: &str = "app-quit";
const TRAY_ICON_SIZE: u32 = 32;

static SHELL_ERROR_CATEGORIES_REPORTED: AtomicU8 = AtomicU8::new(0);

#[derive(Clone, Copy)]
pub(crate) enum ShellOperation {
    Visibility = 1 << 0,
    BehaviorPause = 1 << 1,
    Position = 1 << 2,
    AlwaysOnTop = 1 << 3,
    TrayPresentation = 1 << 4,
    Reachability = 1 << 5,
}

impl ShellOperation {
    fn label(self) -> &'static str {
        match self {
            Self::Visibility => "visibility",
            Self::BehaviorPause => "behavior-pause",
            Self::Position => "position",
            Self::AlwaysOnTop => "always-on-top",
            Self::TrayPresentation => "tray-presentation",
            Self::Reachability => "reachability",
        }
    }
}

pub fn install(app: &mut App) -> tauri::Result<()> {
    // Menu IDs are stable machine-readable values; labels are only presentation.
    // Tauri routes the selected native menu item back through `on_menu_event`.
    let show_item = MenuItem::with_id(app, MENU_SHOW_ID, "Show", true, None::<&str>)?;
    let hide_item = MenuItem::with_id(app, MENU_HIDE_ID, "Hide", true, None::<&str>)?;
    let pause_item = MenuItem::with_id(app, MENU_PAUSE_ID, "Pause Actions", true, None::<&str>)?;
    let reset_position_item = MenuItem::with_id(
        app,
        MENU_RESET_POSITION_ID,
        "Reset Position",
        true,
        None::<&str>,
    )?;
    let always_on_top_item = MenuItem::with_id(
        app,
        MENU_ALWAYS_ON_TOP_ID,
        "Always on Top: On",
        true,
        None::<&str>,
    )?;
    let quit_item = MenuItem::with_id(app, MENU_QUIT_ID, "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &show_item,
            &hide_item,
            &pause_item,
            &reset_position_item,
            &always_on_top_item,
            &quit_item,
        ],
    )?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(placeholder_tray_icon())
        .tooltip("Phoebo")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            MENU_SHOW_ID => run_shell_operation(
                ShellOperation::Visibility,
                desktop::set_main_window_visibility(app, true),
            ),
            MENU_HIDE_ID => run_shell_operation(
                ShellOperation::Visibility,
                desktop::set_main_window_visibility(app, false),
            ),
            MENU_PAUSE_ID => match desktop::toggle_behavior_paused(app) {
                Ok(true) => run_shell_operation(
                    ShellOperation::TrayPresentation,
                    pause_item.set_text("Resume Actions"),
                ),
                Ok(false) => run_shell_operation(
                    ShellOperation::TrayPresentation,
                    pause_item.set_text("Pause Actions"),
                ),
                Err(error) => report_shell_error(ShellOperation::BehaviorPause, error),
            },
            MENU_RESET_POSITION_ID => run_shell_operation(
                ShellOperation::Position,
                desktop::reset_main_window_position_impl(app),
            ),
            MENU_ALWAYS_ON_TOP_ID => match desktop::toggle_always_on_top(app) {
                Ok(true) => run_shell_operation(
                    ShellOperation::TrayPresentation,
                    always_on_top_item.set_text("Always on Top: On"),
                ),
                Ok(false) => run_shell_operation(
                    ShellOperation::TrayPresentation,
                    always_on_top_item.set_text("Always on Top: Off"),
                ),
                Err(error) => report_shell_error(ShellOperation::AlwaysOnTop, error),
            },
            MENU_QUIT_ID => app.exit(0),
            _ => {}
        })
        .build(app)?;

    Ok(())
}

#[tauri::command]
pub fn report_runtime_failure(app: AppHandle) -> Result<(), String> {
    let tray = app
        .tray_by_id(TRAY_ID)
        .ok_or_else(|| "Phoebo's recovery tray is unavailable".to_owned())?;

    // Release builds have no console window. A short native tooltip signals that
    // loading failed while preserving a working menu and explicit Quit action.
    tray.set_tooltip(Some(
        "Phoebo stopped after an error — Quit remains available",
    ))
    .map_err(|_| "Could not update Phoebo's recovery tray".to_owned())
}

fn run_shell_operation(operation: ShellOperation, result: tauri::Result<()>) {
    if let Err(error) = result {
        report_shell_error(operation, error);
    }
}

pub(crate) fn report_shell_error(operation: ShellOperation, message: impl std::fmt::Display) {
    // A broken native operation could otherwise flood stderr on repeated tray
    // clicks. Keep one diagnostic per fixed category so an early minor menu error
    // cannot hide a later reachability or lifecycle failure.
    let bit = operation as u8;
    let previous = SHELL_ERROR_CATEGORIES_REPORTED.fetch_or(bit, Ordering::Relaxed);
    if previous & bit == 0 {
        eprintln!("[desktop-shell:{}] {message}", operation.label());
    }
}

fn placeholder_tray_icon() -> Image<'static> {
    // Generate the small RGBA icon in memory so Milestone 1 does not need another
    // runtime asset or image-decoding dependency. Zero-filled pixels stay transparent.
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
