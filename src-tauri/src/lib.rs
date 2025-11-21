use tauri::command;
use std::fs;

// Command to write content to a file
#[command]
fn save_content(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|err| err.to_string())
}

// Command to read content from a file
#[command]
fn read_content(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|err| err.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            save_content, // Register the save command
            read_content  // Register the read command
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}