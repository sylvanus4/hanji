// Hides the console window that Windows would otherwise open behind the app.
// Only in release: during development that console is where panics show up.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    hanji_lib::run()
}
