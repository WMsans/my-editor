pub mod protocol;
pub mod state;
pub mod network;
mod commands;

use std::sync::Arc;
use tokio::sync::Mutex;
use crate::state::PeerState;
use crate::protocol::Payload;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let peer_state = PeerState::new();

    let (tx, rx) = tokio::sync::mpsc::channel::<(String, Payload)>(32);
    let tx = Arc::new(Mutex::new(tx));

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(peer_state.clone()) 
        .manage(tx.clone())
        .setup(move |app| {
            let handle = app.handle().clone();
            let state_for_thread = peer_state.clone(); 
            
            tauri::async_runtime::spawn(async move {
                // OPTION 1: Load from Environment Variable (Good for Dev)
                let bootnodes = std::env::var("BOOTNODE_LIST")
                    .unwrap_or_else(|_| "/ip4/35.212.216.37/tcp/4001/p2p/12D3KooWBNmqJNCHVjeJMCbbG1WSzx2uazXaXuteuovfGLNpz4xH".to_string())
                    .split(',')
                    .map(|s| s.to_string())
                    .collect();

                // Pass the list to the function
                if let Err(e) = network::start_p2p_node(handle, state_for_thread, rx, None, bootnodes).await {
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
            // NEW: Register new command
            commands::broadcast_file_content,
            commands::get_local_peer_id,
            commands::git_pull,
            commands::get_local_addrs
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}