/*!
hanji desktop shell.

There is deliberately almost nothing here. Every format engine — the Hangul
WASM renderer, pdf.js, the raster and archive writers — already runs inside the
web view, so the Rust side owns exactly three things the browser cannot do for
itself: put up a native Save panel, write the bytes it chose, and drive the
system print dialog.

Keeping the shell this thin is the point rather than an accident. The claim the
product makes is that documents stay on the machine, and the smallest honest way
to support that claim is a shell with no network client compiled into it at all.
*/

/// Hand the current view to the operating system's print dialog.
///
/// This exists because `window.print()` is not dependable inside a packaged web
/// view. On macOS, WebKit prints only when the host application runs an
/// NSPrintOperation itself, so a JavaScript call can return having done
/// nothing at all — the worst possible outcome for a button, since the user
/// blames the document rather than the button. `WebviewWindow::print` goes
/// through wry, which implements the real thing on macOS, Windows and Linux.
///
/// The error is stringified because the front end only needs to tell the user
/// that the dialog could not be opened; the typed variant carries no detail a
/// person could act on.
#[tauri::command]
fn print_document(window: tauri::WebviewWindow) -> Result<(), String> {
    window.print().map_err(|error| error.to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![print_document])
        .run(tauri::generate_context!())
        .expect("hanji failed to start");
}
