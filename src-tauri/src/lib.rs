use tauri::{command, AppHandle, Emitter, Manager, State}; 
use std::fs;
use std::time::Duration;
use std::collections::HashSet;
use std::sync::{Arc, Mutex}; 
use libp2p::{
    mdns, noise, tcp, yamux,
    swarm::{NetworkBehaviour, SwarmEvent},
    SwarmBuilder, PeerId,
};
use futures::stream::StreamExt;

// Define shared state to hold connected peers
struct PeerState {
    peers: Arc<Mutex<HashSet<String>>>,
}

#[derive(NetworkBehaviour)]
struct MyBehaviour {
    mdns: mdns::tokio::Behaviour,
    ping: libp2p::ping::Behaviour,
}

#[command]
fn save_content(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|err| err.to_string())
}

#[command]
fn read_content(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|err| err.to_string())
}

// New command for the frontend to fetch peers on load
#[command]
fn get_peers(state: State<'_, PeerState>) -> Result<Vec<String>, String> {
    let peers = state.peers.lock().map_err(|e| e.to_string())?;
    Ok(peers.iter().cloned().collect())
}

// Pass the shared peers state into the background task
async fn start_p2p_node(app_handle: AppHandle, peers_state: Arc<Mutex<HashSet<String>>>) -> Result<(), Box<dyn std::error::Error>> {
    let mut swarm = SwarmBuilder::with_new_identity()
        .with_tokio()
        .with_tcp(
            tcp::Config::default(),
            noise::Config::new,
            yamux::Config::default,
        )?
        .with_behaviour(|key| {
            let mdns = mdns::tokio::Behaviour::new(
                mdns::Config::default(),
                key.public().to_peer_id(),
            )?;
            let ping = libp2p::ping::Behaviour::default();
            Ok(MyBehaviour { mdns, ping })
        })?
        .with_swarm_config(|c| c.with_idle_connection_timeout(Duration::from_secs(60)))
        .build();

    swarm.listen_on("/ip4/0.0.0.0/tcp/0".parse()?)?;

    loop {
        match swarm.select_next_some().await {
            SwarmEvent::NewListenAddr { address, .. } => {
                println!("Listening on {address:?}");
            }
            SwarmEvent::Behaviour(MyBehaviourEvent::Mdns(mdns::Event::Discovered(list))) => {
                for (peer_id, _multiaddr) in list {
                    println!("mDNS discovered a new peer: {peer_id}");
                    let peer_str = peer_id.to_string();
                    
                    // 1. Update State
                    peers_state.lock().unwrap().insert(peer_str.clone());
                    
                    // 2. Notify Frontend
                    let _ = app_handle.emit("peer-discovered", peer_str);
                }
            }
            SwarmEvent::Behaviour(MyBehaviourEvent::Mdns(mdns::Event::Expired(list))) => {
                for (peer_id, _multiaddr) in list {
                    println!("mDNS discover peer has expired: {peer_id}");
                    let peer_str = peer_id.to_string();
                    
                    // 1. Update State
                    peers_state.lock().unwrap().remove(&peer_str);

                    // 2. Notify Frontend
                    let _ = app_handle.emit("peer-expired", peer_str);
                }
            }
            _ => {}
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize the shared state
    let peers = Arc::new(Mutex::new(HashSet::new()));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(PeerState { peers: peers.clone() }) // Register state with Tauri
        .setup(move |app| {
            let handle = app.handle().clone();
            let peers_state = peers.clone(); // Clone for the async task

            tauri::async_runtime::spawn(async move {
                if let Err(e) = start_p2p_node(handle, peers_state).await {
                    eprintln!("P2P Network Error: {e}");
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            save_content, 
            read_content,
            get_peers // Register new command
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}