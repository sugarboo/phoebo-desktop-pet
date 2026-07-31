use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter, Manager, Monitor, PhysicalPosition, PhysicalSize, WebviewWindow};

pub const MAIN_WINDOW_LABEL: &str = "main";
pub const BEHAVIOR_PAUSED_EVENT: &str = "phoebo-behavior-paused";
pub const WINDOW_VISIBLE_EVENT: &str = "phoebo-window-visible";

const MINIMUM_REACHABLE_EDGE_PX: i64 = 48;
const MAIN_WINDOW_LOGICAL_WIDTH: f64 = 120.0;
const MAIN_WINDOW_LOGICAL_HEIGHT: f64 = 130.0;

static BEHAVIOR_PAUSED: AtomicBool = AtomicBool::new(false);
static ALWAYS_ON_TOP: AtomicBool = AtomicBool::new(true);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct WorkArea {
    x: i64,
    y: i64,
    width: i64,
    height: i64,
}

#[tauri::command]
pub fn is_behavior_paused() -> bool {
    BEHAVIOR_PAUSED.load(Ordering::Relaxed)
}

#[tauri::command]
pub fn is_left_mouse_button_pressed() -> bool {
    platform_left_mouse_button_pressed()
}

#[tauri::command]
pub fn show_main_window(app: AppHandle) -> Result<(), String> {
    set_main_window_visibility(&app, true).map_err(|_| "Could not show Phoebo".to_owned())
}

#[tauri::command]
pub fn hide_main_window(app: AppHandle) -> Result<(), String> {
    set_main_window_visibility(&app, false).map_err(|_| "Could not hide Phoebo".to_owned())
}

#[tauri::command]
pub fn reset_main_window_position(app: AppHandle) -> Result<(), String> {
    reset_main_window_position_impl(&app)
        .map_err(|_| "Could not reset Phoebo's position".to_owned())
}

#[tauri::command]
pub fn set_main_window_always_on_top(app: AppHandle, enabled: bool) -> Result<(), String> {
    set_main_window_always_on_top_impl(&app, enabled)
        .map_err(|_| "Could not change Phoebo's always-on-top state".to_owned())
}

pub fn toggle_behavior_paused(app: &AppHandle) -> tauri::Result<bool> {
    // Tray callbacks are serialized on Tauri's main thread. Emit first, then
    // publish the new native snapshot so a failed event cannot split Rust state
    // from the frontend runtime state.
    let paused = !BEHAVIOR_PAUSED.load(Ordering::Relaxed);
    emit_to_main_window(app, BEHAVIOR_PAUSED_EVENT, paused)?;
    BEHAVIOR_PAUSED.store(paused, Ordering::Relaxed);
    Ok(paused)
}

pub fn toggle_always_on_top(app: &AppHandle) -> tauri::Result<bool> {
    let enabled = !ALWAYS_ON_TOP.load(Ordering::Relaxed);
    set_main_window_always_on_top_impl(app, enabled)?;
    Ok(enabled)
}

pub fn set_main_window_visibility(app: &AppHandle, visible: bool) -> tauri::Result<()> {
    let window = require_main_window(app)?;

    if visible {
        // A disconnected monitor or changed DPI can invalidate an old physical
        // position. Clamp before showing so the recovery action is always useful.
        ensure_window_reachable(&window)?;
        window.show()?;
        if let Err(error) = window.emit(WINDOW_VISIBLE_EVENT, true) {
            // Showing without resuming is recoverable but inconsistent. Roll the
            // native operation back and keep the runtime in its hidden state.
            let _ = window.hide();
            let _ = window.emit(WINDOW_VISIBLE_EVENT, false);
            return Err(error);
        }
    } else {
        // Pause the frontend before hiding. If the native hide fails, compensate
        // with a visible event so a still-visible pet does not remain suspended.
        window.emit(WINDOW_VISIBLE_EVENT, false)?;
        if let Err(error) = window.hide() {
            let _ = window.emit(WINDOW_VISIBLE_EVENT, true);
            return Err(error);
        }
    }

    Ok(())
}

pub fn enforce_main_window_size(app: &AppHandle) -> tauri::Result<()> {
    let window = require_main_window(app)?;
    let logical_size =
        tauri::LogicalSize::new(MAIN_WINDOW_LOGICAL_WIDTH, MAIN_WINDOW_LOGICAL_HEIGHT);

    // Windows applies its default minimum tracking width while the native window
    // is first being created. By setup time Tao's window subclass is installed,
    // so reapplying the reviewed constraints can honor a 120 px-wide pet.
    window.set_min_size(Some(logical_size))?;
    window.set_max_size(Some(logical_size))?;
    window.set_size(logical_size)
}

pub fn reset_main_window_position_impl(app: &AppHandle) -> tauri::Result<()> {
    let window = require_main_window(app)?;
    let monitor = match choose_preferred(
        window.primary_monitor(),
        || window.current_monitor(),
        || {
            window
                .available_monitors()
                .map(|monitors| monitors.into_iter().next())
        },
    ) {
        Ok(monitor) => monitor,
        Err(error) => {
            #[cfg(not(target_os = "windows"))]
            {
                let _ = error;
                None
            }
            #[cfg(target_os = "windows")]
            return Err(error);
        }
    };

    let Some(monitor) = monitor else {
        // Some reduced Wayland environments do not expose monitor geometry. Leave
        // the stationary window untouched instead of inventing global coordinates.
        return Ok(());
    };

    let work_area = WorkArea::from_monitor(&monitor);
    let window_size = window.outer_size()?;
    let x = centered_axis(work_area.x, work_area.width, i64::from(window_size.width));
    let y = centered_axis(work_area.y, work_area.height, i64::from(window_size.height));
    window.set_position(PhysicalPosition::new(to_i32(x), to_i32(y)))?;
    Ok(())
}

pub fn set_main_window_always_on_top_impl(app: &AppHandle, enabled: bool) -> tauri::Result<()> {
    let window = require_main_window(app)?;
    window.set_always_on_top(enabled)?;
    ALWAYS_ON_TOP.store(enabled, Ordering::Relaxed);
    Ok(())
}

pub fn ensure_main_window_reachable(app: &AppHandle) -> tauri::Result<()> {
    let window = require_main_window(app)?;
    ensure_window_reachable(&window)
}

fn ensure_window_reachable(window: &WebviewWindow) -> tauri::Result<()> {
    let monitors = match window.available_monitors() {
        Ok(monitors) => monitors,
        Err(error) => {
            // Global coordinates can be unavailable on Wayland. The documented
            // cross-platform fallback is a stationary window, not a failed Show.
            #[cfg(not(target_os = "windows"))]
            {
                let _ = error;
                return Ok(());
            }
            #[cfg(target_os = "windows")]
            return Err(error);
        }
    };
    if monitors.is_empty() {
        return Ok(());
    }

    let position = window.outer_position()?;
    let size = window.outer_size()?;
    let work_areas: Vec<WorkArea> = monitors.iter().map(WorkArea::from_monitor).collect();
    let clamped = clamp_window_position(position, size, &work_areas);

    if clamped != position {
        window.set_position(clamped)?;
    }
    Ok(())
}

fn require_main_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    app.get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| tauri::Error::WindowNotFound)
}

fn emit_to_main_window(app: &AppHandle, event_name: &str, payload: bool) -> tauri::Result<()> {
    require_main_window(app)?.emit(event_name, payload)?;
    Ok(())
}

fn clamp_window_position(
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    work_areas: &[WorkArea],
) -> PhysicalPosition<i32> {
    let window = WorkArea {
        x: i64::from(position.x),
        y: i64::from(position.y),
        width: i64::from(size.width),
        height: i64::from(size.height),
    };
    let target = select_target_work_area(window, work_areas);
    let x = clamp_axis(window.x, window.width, target.x, target.width);
    let y = clamp_axis(window.y, window.height, target.y, target.height);
    PhysicalPosition::new(to_i32(x), to_i32(y))
}

fn select_target_work_area(window: WorkArea, work_areas: &[WorkArea]) -> WorkArea {
    work_areas
        .iter()
        .copied()
        .max_by_key(|work_area| {
            let intersection = intersection_area(window, *work_area);
            if intersection > 0 {
                // Intersecting monitors always outrank non-intersecting monitors.
                (1_i128, intersection, 0_i128)
            } else {
                // For an orphaned position, choose the nearest work area. Negating
                // squared distance lets max_by_key retain the closest candidate.
                (
                    0_i128,
                    0_i128,
                    -distance_squared_to_rect(window, *work_area),
                )
            }
        })
        .expect("work areas are checked as nonempty")
}

fn intersection_area(left: WorkArea, right: WorkArea) -> i128 {
    let width = (left.x + left.width).min(right.x + right.width) - left.x.max(right.x);
    let height = (left.y + left.height).min(right.y + right.height) - left.y.max(right.y);
    i128::from(width.max(0)) * i128::from(height.max(0))
}

fn distance_squared_to_rect(window: WorkArea, work_area: WorkArea) -> i128 {
    let center_x = window.x + window.width / 2;
    let center_y = window.y + window.height / 2;
    let nearest_x = center_x.clamp(work_area.x, work_area.x + work_area.width);
    let nearest_y = center_y.clamp(work_area.y, work_area.y + work_area.height);
    let delta_x = i128::from(center_x - nearest_x);
    let delta_y = i128::from(center_y - nearest_y);
    delta_x * delta_x + delta_y * delta_y
}

fn clamp_axis(position: i64, window_length: i64, work_start: i64, work_length: i64) -> i64 {
    let visible_edge = MINIMUM_REACHABLE_EDGE_PX
        .min(window_length.max(1))
        .min(work_length.max(1));
    let minimum = work_start - window_length + visible_edge;
    let maximum = work_start + work_length - visible_edge;

    if minimum <= maximum {
        position.clamp(minimum, maximum)
    } else {
        centered_axis(work_start, work_length, window_length)
    }
}

fn centered_axis(work_start: i64, work_length: i64, window_length: i64) -> i64 {
    work_start + (work_length - window_length) / 2
}

fn choose_preferred<T, E>(
    primary: Result<Option<T>, E>,
    current: impl FnOnce() -> Result<Option<T>, E>,
    available: impl FnOnce() -> Result<Option<T>, E>,
) -> Result<Option<T>, E> {
    let mut last_error = None;

    match primary {
        Ok(Some(value)) => return Ok(Some(value)),
        Ok(None) => {}
        Err(error) => last_error = Some(error),
    }
    match current() {
        Ok(Some(value)) => return Ok(Some(value)),
        Ok(None) => {}
        Err(error) => last_error = Some(error),
    }
    match available() {
        Ok(Some(value)) => return Ok(Some(value)),
        Ok(None) => {}
        Err(error) => last_error = Some(error),
    }

    match last_error {
        Some(error) => Err(error),
        None => Ok(None),
    }
}

fn to_i32(value: i64) -> i32 {
    value.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32
}

#[cfg(target_os = "windows")]
fn platform_left_mouse_button_pressed() -> bool {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};

    // SAFETY: GetAsyncKeyState reads process-external input state and takes no
    // pointer. Its high bit reports whether the physical left button is down now.
    unsafe { GetAsyncKeyState(i32::from(VK_LBUTTON)) < 0 }
}

#[cfg(not(target_os = "windows"))]
fn platform_left_mouse_button_pressed() -> bool {
    // Windows is the current acceptance platform. Other platforms still receive
    // native move bursts but end direct control at the first stationary check.
    false
}

impl WorkArea {
    fn from_monitor(monitor: &Monitor) -> Self {
        let area = monitor.work_area();
        Self {
            x: i64::from(area.position.x),
            y: i64::from(area.position.y),
            width: i64::from(area.size.width),
            height: i64::from(area.size.height),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use super::{choose_preferred, clamp_window_position, intersection_area, WorkArea};
    use tauri::{PhysicalPosition, PhysicalSize};

    const PRIMARY: WorkArea = WorkArea {
        x: 0,
        y: 0,
        width: 1920,
        height: 1040,
    };

    #[test]
    fn reachable_position_is_not_changed() {
        let position = PhysicalPosition::new(400, 300);
        let actual = clamp_window_position(position, PhysicalSize::new(120, 130), &[PRIMARY]);

        assert_eq!(actual, position);
    }

    #[test]
    fn orphaned_position_moves_to_nearest_monitor_edge() {
        let secondary = WorkArea {
            x: 1920,
            y: 0,
            width: 2560,
            height: 1400,
        };
        let actual = clamp_window_position(
            PhysicalPosition::new(7000, 200),
            PhysicalSize::new(120, 130),
            &[PRIMARY, secondary],
        );

        assert_eq!(actual, PhysicalPosition::new(4432, 200));
    }

    #[test]
    fn negative_monitor_coordinates_remain_supported() {
        let left_monitor = WorkArea {
            x: -1280,
            y: -200,
            width: 1280,
            height: 1024,
        };
        let actual = clamp_window_position(
            PhysicalPosition::new(-1500, -500),
            PhysicalSize::new(120, 130),
            &[left_monitor, PRIMARY],
        );

        assert_eq!(actual, PhysicalPosition::new(-1352, -282));
    }

    #[test]
    fn intersection_uses_physical_rectangles() {
        let window = WorkArea {
            x: 1900,
            y: 100,
            width: 120,
            height: 130,
        };
        let secondary = WorkArea {
            x: 1920,
            y: 0,
            width: 2560,
            height: 1400,
        };

        assert_eq!(intersection_area(window, PRIMARY), 2_600);
        assert_eq!(intersection_area(window, secondary), 13_000);
    }

    #[test]
    fn primary_monitor_short_circuits_fallible_fallbacks() {
        let fallback_call_count = Cell::new(0);
        let selected = choose_preferred(
            Ok::<_, &str>(Some("primary")),
            || {
                fallback_call_count.set(fallback_call_count.get() + 1);
                Ok(Some("current"))
            },
            || {
                fallback_call_count.set(fallback_call_count.get() + 1);
                Ok(Some("available"))
            },
        );

        assert_eq!(selected, Ok(Some("primary")));
        assert_eq!(fallback_call_count.get(), 0);
    }

    #[test]
    fn monitor_selection_reports_an_error_only_when_no_fallback_succeeds() {
        let selected = choose_preferred(
            Err::<Option<&str>, _>("primary failed"),
            || Ok(None),
            || Err("available failed"),
        );

        assert_eq!(selected, Err("available failed"));
    }
}
