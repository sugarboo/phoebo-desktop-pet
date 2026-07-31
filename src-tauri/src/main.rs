// Release builds are GUI applications on Windows, so they should not open an extra
// console window. Debug builds keep the console because it is useful while learning
// and diagnosing Tauri startup.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Keep the executable entry point tiny. The library owns the Tauri builder so
    // its setup and lifecycle behavior can be checked independently.
    phoebo_desktop_pet_lib::run()
}
