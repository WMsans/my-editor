mod protocol;
mod state;
mod network;
mod commands;

use tauri::{Manager, State};
use std::sync::Arc;
use tokio::sync::Mutex;
use crate::state::PeerState;
use crate::protocol::Payload;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 1. Create the shared state ONCE.
    // Because PeerState derives Clone (wrapping Arcs), cloning it shares the underlying data.
    let peer_state = PeerState::new();

    let (tx, rx) = tokio::sync::mpsc::channel::<(String, Payload)>(32);
    let tx = Arc::new(Mutex::new(tx));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // 2. Register the state with Tauri
        .manage(peer_state.clone()) 
        .manage(tx.clone())
        .setup(move |app| {
            let handle = app.handle().clone();
            // 3. Pass the SAME state to the background thread
            let state_for_thread = peer_state.clone(); 
            
            tauri::async_runtime::spawn(async move {
                if let Err(e) = network::start_p2p_node(handle, state_for_thread, rx).await {
                    eprintln!("P2P Network Error: {e}");
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_peers,
            commands::request_join,
            commands::approve_join,
            commands::broadcast_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}