// src/bin/bootnode.rs
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use serde::Serialize;
use tokio::sync::mpsc;
// Import your library modules
use my_editor_lib::network::{self, PeerHost}; // Replace 'my_project_name' with your actual crate name from Cargo.toml
use my_editor_lib::state::PeerState;
use my_editor_lib::protocol::Payload;

// 1. Create a "Headless" Host that just prints to console
struct HeadlessHost;

impl PeerHost for HeadlessHost {
    fn emit<T: Serialize + Clone + Send>(&self, event: &str, payload: T) {
        // On a server, we just log events to stdout
        let json = serde_json::to_string(&payload).unwrap_or_default();
        println!("[EVENT {}] {}", event, json);
    }
    
    fn get_app_data_dir(&self) -> PathBuf {
        // Servers usually store data in the current folder or /var/lib/...
        PathBuf::from(".") 
    }
}

#[tokio::main]
async fn main() {
    println!("Starting Headless P2P Bootnode...");

    let state = PeerState::new();
    let (tx, rx) = mpsc::channel::<(String, Payload)>(32);
    // We don't really use 'tx' on the server since there is no UI to send commands,
    // but the network function requires it.
    let _tx = Arc::new(Mutex::new(tx));

    let host = HeadlessHost;

    // Run the node!
    if let Err(e) = network::start_p2p_node(host, state, rx).await {
        eprintln!("Node crashed: {}", e);
    }
}