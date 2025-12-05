mod protocol;
mod state;
mod network;
mod commands;

use std::sync::Arc;
use tokio::sync::Mutex;
use crate::state::PeerState;
use crate::protocol::Payload;
use tauri::http::{Response, StatusCode};
use tauri::Manager; // [FIX] Required to access .path() and .app_handle()

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let peer_state = PeerState::new();

    let (tx, rx) = tokio::sync::mpsc::channel::<(String, Payload)>(32);
    let tx = Arc::new(Mutex::new(tx));

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .register_uri_scheme_protocol("plugin", move |ctx, request| { // [FIX] 'ctx' is UriSchemeContext
            // [FIX] Extract the AppHandle from the context
            match handle_plugin_request(ctx.app_handle(), &request) {
                Ok(response) => response,
                Err(e) => {
                    eprintln!("Plugin Request Error: {}", e);
                    Response::builder()
                        .status(StatusCode::INTERNAL_SERVER_ERROR)
                        .body(e.to_string().into_bytes())
                        .unwrap()
                }
            }
        })
        // -----------------------------------------------------
        .manage(peer_state.clone())
        .manage(tx.clone())
        .setup(move |app| {
            let handle = app.handle().clone();
            let state_for_thread = peer_state.clone();

            tauri::async_runtime::spawn(async move {
                if let Err(e) = network::start_p2p_node(handle, state_for_thread, rx).await {
                    eprintln!("P2P Network Error: {e}");
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::request_join,
            commands::approve_join,
            commands::broadcast_update,
            commands::read_directory,
            commands::read_file_content,
            commands::write_file_content,
            commands::init_git_repo,
            commands::set_remote_origin,
            commands::push_changes,
            commands::get_remote_origin,
            commands::save_incoming_project,
            commands::request_file_sync,
            commands::broadcast_file_content,
            commands::get_local_peer_id,
            commands::git_pull,
            commands::get_local_addrs
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn handle_plugin_request(
    app: &tauri::AppHandle,
    request: &tauri::http::Request<Vec<u8>>,
) -> Result<Response<Vec<u8>>, Box<dyn std::error::Error>> {
    // 1. Parse the URI (e.g., plugin://simulation-block/webview.html)
    let uri = request.uri();
    let plugin_id = uri.host().ok_or("No plugin ID found")?;
    let path = uri.path().trim_start_matches('/');

    // 2. Construct the file path
    // [FIX] Prioritize AppLocalData/plugins (Production/Storage) to match App.tsx
    // This fixes the "plugins not loading" issue by checking the correct storage location.
    let app_local_data = app.path().app_local_data_dir()?;
    let plugin_root_storage = app_local_data.join("plugins");

    // Fallback: Check CWD/plugins (Dev mode convenience) if storage doesn't exist
    let mut root_to_use = plugin_root_storage.clone();
    
    if !root_to_use.exists() {
        if let Ok(cwd) = std::env::current_dir() {
            let mut dev_root = cwd.clone();
            dev_root.push("plugins");
            // Check ./plugins
            if dev_root.exists() {
                root_to_use = dev_root;
            } else {
                // Check ../plugins (common in tauri dev environment)
                dev_root.pop(); dev_root.pop(); dev_root.push("plugins");
                if dev_root.exists() {
                    root_to_use = dev_root;
                }
            }
        }
    }

    let mut file_path = root_to_use;
    file_path.push(plugin_id);
    file_path.push(path);

    // 3. Security Check: Prevent directory traversal
    if !file_path.exists() {
        println!("Plugin file not found at: {:?}", file_path);
        return Ok(Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(format!("File not found: {:?}", file_path).into_bytes())?);
    }

    // 4. Determine MIME Type
    let extension = file_path.extension().and_then(|s| s.to_str()).unwrap_or("");
    let mime_type = match extension {
        "html" => "text/html",
        "js" => "text/javascript",
        "css" => "text/css",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        _ => "application/octet-stream",
    };

    // 5. Read and Return Content
    let content = std::fs::read(&file_path)?;
    Response::builder()
        .header("Content-Type", mime_type)
        .header("Access-Control-Allow-Origin", "*")
        .body(content)
        .map_err(|e| e.into())
}