// src/bin/bootnode.rs
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use serde::Serialize;
use tokio::sync::mpsc;
use std::env;
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

    // READ PUBLIC IP FROM ENV
    let public_ip = env::var("BOOTNODE_IP").ok();
    
    if let Some(ref ip) = public_ip {
        println!("Configured with Public IP: {}", ip);
    } else {
        println!("⚠️ NO PUBLIC IP DETECTED. AutoNAT/Hole Punching may fail.");
    }

    let state = PeerState::new();
    let (tx, rx) = mpsc::channel::<(String, Payload)>(32);
    let _tx = Arc::new(Mutex::new(tx));
    let host = HeadlessHost;

    // Pass public_ip to start_p2p_node
    if let Err(e) = network::start_p2p_node(host, state, rx, public_ip).await {
        eprintln!("Node crashed: {}", e);
    }
}