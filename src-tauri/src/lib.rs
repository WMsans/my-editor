mod protocol;
mod state;
mod network;
mod commands;

use std::sync::Arc;
use tokio::sync::Mutex;
use crate::state::PeerState;
use crate::protocol::Payload;
use tauri::http::{Response, StatusCode}; 

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let peer_state = PeerState::new();

    let (tx, rx) = tokio::sync::mpsc::channel::<(String, Payload)>(32);
    let tx = Arc::new(Mutex::new(tx));

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .register_uri_scheme_protocol("plugin", move |_app, request| {
            match handle_plugin_request(&request) {
                Ok(response) => response,
                Err(e) => Response::builder()
                    .status(StatusCode::INTERNAL_SERVER_ERROR)
                    .body(e.to_string().into_bytes())
                    .unwrap(),
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
    request: &tauri::http::Request<Vec<u8>>,
) -> Result<Response<Vec<u8>>, Box<dyn std::error::Error>> {
    // 1. Parse the URI (e.g., plugin://simulation-block/webview.html)
    let uri = request.uri();
    let plugin_id = uri.host().ok_or("No plugin ID found")?;
    let path = uri.path().trim_start_matches('/');

    // 2. Construct the file path
    // Try current_dir/plugins (Production) first, then ../plugins (Dev)
    let cwd = std::env::current_dir()?;
    let mut plugin_root = cwd.clone();
    plugin_root.push("plugins");

    if !plugin_root.exists() {
        plugin_root.pop(); // remove 'plugins'
        plugin_root.pop(); // remove 'src-tauri' (go up one level)
        plugin_root.push("plugins");
    }

    let mut file_path = plugin_root;
    file_path.push(plugin_id);
    file_path.push(path);

    // 3. Security Check: Prevent directory traversal
    // (Optional: Ideally ensure file_path starts with plugin_root)
    if !file_path.exists() {
        println!("Plugin file not found at: {:?}", file_path); // Helpful for debugging
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