/*!
hanji desktop shell.

There is deliberately almost nothing here. Every format engine — the Hangul
WASM renderer, pdf.js, the raster and archive writers — already runs inside the
web view, so the Rust side owns exactly two things the browser cannot do for
itself: put up a native Save panel, and write the bytes it chose.

Keeping the shell this thin is the point rather than an accident. The claim the
product makes is that documents stay on the machine, and the smallest honest way
to support that claim is a shell with no network client compiled into it at all.
*/

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("hanji failed to start");
}
