use tauri::{command, AppHandle, Emitter, Manager, State}; 
use std::fs;
use std::time::Duration;
use std::collections::{HashSet, HashMap};
use std::sync::{Arc, Mutex}; 
use libp2p::{
    mdns, noise, tcp, yamux,
    swarm::{NetworkBehaviour, SwarmEvent},
    SwarmBuilder, PeerId, StreamProtocol,
    request_response::{self, ProtocolSupport},
};
use serde::{Deserialize, Serialize};
use futures::stream::StreamExt;

// --- 1. Define the Protocol Messages ---

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum AppRequest {
    Join { username: String },
    Sync { data: Vec<u8> }, // NEW: Carries Yjs updates
    Ping,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum AppResponse {
    Join { accepted: bool, content: Option<Vec<u8>> }, // CHANGED: Content is binary (Yjs state)
    Ack,
    Pong,
}

// --- 2. State Definitions ---

struct PeerState {
    peers: Arc<Mutex<HashSet<String>>>, // Discovered via mDNS
    pending_invites: Arc<Mutex<HashMap<String, request_response::ResponseChannel<AppResponse>>>>,
    active_peers: Arc<Mutex<HashSet<String>>>, // NEW: Peers we are collaborating with
}

#[derive(NetworkBehaviour)]
struct MyBehaviour {
    mdns: mdns::tokio::Behaviour,
    request_response: request_response::json::Behaviour<AppRequest, AppResponse>,
}

// --- 3. Tauri Commands ---

#[command]
fn save_content(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|err| err.to_string())
}

#[command]
fn read_content(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|err| err.to_string())
}

#[command]
fn get_peers(state: State<'_, PeerState>) -> Result<Vec<String>, String> {
    let peers = state.peers.lock().map_err(|e| e.to_string())?;
    Ok(peers.iter().cloned().collect())
}

// Command 1: Request to Join
#[command]
async fn request_join(
    peer_id: String, 
    sender: State<'_, Arc<tokio::sync::Mutex<tokio::sync::mpsc::Sender<(String, Payload)>>>>
) -> Result<(), String> {
    let tx = sender.lock().await;
    tx.send(("join".to_string(), Payload::PeerId(peer_id))).await.map_err(|e| e.to_string())
}

// Command 2: Approve Join (sends initial state)
#[command]
async fn approve_join(
    peer_id: String, 
    content: Vec<u8>, // Changed to binary
    sender: State<'_, Arc<tokio::sync::Mutex<tokio::sync::mpsc::Sender<(String, Payload)>>>>
) -> Result<(), String> {
    let tx = sender.lock().await;
    tx.send(("accept".to_string(), Payload::JoinAccept { peer_id, content })).await.map_err(|e| e.to_string())
}

// Command 3: Broadcast Update (sends incremental updates)
#[command]
async fn broadcast_update(
    data: Vec<u8>,
    sender: State<'_, Arc<tokio::sync::Mutex<tokio::sync::mpsc::Sender<(String, Payload)>>>>
) -> Result<(), String> {
    let tx = sender.lock().await;
    tx.send(("sync".to_string(), Payload::SyncData(data))).await.map_err(|e| e.to_string())
}

// Helper enum for the channel payload
#[derive(Debug)]
enum Payload {
    PeerId(String),
    JoinAccept { peer_id: String, content: Vec<u8> },
    SyncData(Vec<u8>),
}

// --- 4. The Network Loop ---

async fn start_p2p_node(
    app_handle: AppHandle, 
    peers_state: Arc<Mutex<HashSet<String>>>,
    pending_invites: Arc<Mutex<HashMap<String, request_response::ResponseChannel<AppResponse>>>>,
    active_peers: Arc<Mutex<HashSet<String>>>, // NEW
    mut cmd_rx: tokio::sync::mpsc::Receiver<(String, Payload)>
) -> Result<(), Box<dyn std::error::Error>> {

    let mut swarm = SwarmBuilder::with_new_identity()
        .with_tokio()
        .with_tcp(tcp::Config::default(), noise::Config::new, yamux::Config::default)?
        .with_behaviour(|key| {
            let mdns = mdns::tokio::Behaviour::new(mdns::Config::default(), key.public().to_peer_id())?;
            let request_response = request_response::json::Behaviour::new(
                [(StreamProtocol::new("/collab/1.0.0"), ProtocolSupport::Full)],
                request_response::Config::default()
            );
            Ok(MyBehaviour { mdns, request_response })
        })?
        .with_swarm_config(|c| c.with_idle_connection_timeout(Duration::from_secs(60)))
        .build();

    swarm.listen_on("/ip4/0.0.0.0/tcp/0".parse()?)?;

    let mut current_host: Option<PeerId> = None;
    let mut heartbeat = tokio::time::interval(Duration::from_secs(3));

    loop {
        tokio::select! {
            _ = heartbeat.tick() => {
                if let Some(host_id) = current_host {
                    swarm.behaviour_mut().request_response.send_request(&host_id, AppRequest::Ping);
                }
            }

            Some((cmd, payload)) = cmd_rx.recv() => {
                match (cmd.as_str(), payload) {
                    ("join", Payload::PeerId(peer_str)) => {
                        if let Ok(peer) = peer_str.parse::<PeerId>() {
                            swarm.behaviour_mut().request_response.send_request(
                                &peer, 
                                AppRequest::Join { username: "Guest".into() }
                            );
                        }
                    },
                    ("accept", Payload::JoinAccept { peer_id, content }) => {
                        let mut pending = pending_invites.lock().unwrap();
                        if let Some(channel) = pending.remove(&peer_id) {
                             // Add to active peers so we broadcast to them later
                             active_peers.lock().unwrap().insert(peer_id.clone());
                             
                             let _ = swarm.behaviour_mut().request_response.send_response(
                                 channel,
                                 AppResponse::Join { accepted: true, content: Some(content) }
                             );
                        }
                    },
                    ("sync", Payload::SyncData(data)) => {
                        // Broadcast to all active peers (Simple iteration)
                        // Note: In a real app, we might use GossipSub for efficiency.
                        let targets: Vec<String> = active_peers.lock().unwrap().iter().cloned().collect();
                        
                        for peer_str in targets {
                            if let Ok(peer) = peer_str.parse::<PeerId>() {
                                swarm.behaviour_mut().request_response.send_request(
                                    &peer,
                                    AppRequest::Sync { data: data.clone() }
                                );
                            }
                        }
                        // Also send to Host if we are a Guest and they aren't in 'active_peers' logic yet
                        if let Some(host) = current_host {
                            swarm.behaviour_mut().request_response.send_request(
                                &host,
                                AppRequest::Sync { data: data.clone() }
                            );
                        }
                    },
                    _ => {}
                }
            }
            
            event = swarm.select_next_some() => {
                match event {
                    SwarmEvent::Behaviour(MyBehaviourEvent::Mdns(mdns::Event::Discovered(list))) => {
                        for (peer_id, _) in list {
                            peers_state.lock().unwrap().insert(peer_id.to_string());
                            let _ = app_handle.emit("peer-discovered", peer_id.to_string());
                        }
                    },
                    SwarmEvent::Behaviour(MyBehaviourEvent::Mdns(mdns::Event::Expired(list))) => {
                        for (peer_id, _) in list {
                            peers_state.lock().unwrap().remove(&peer_id.to_string());
                            let _ = app_handle.emit("peer-expired", peer_id.to_string());
                        }
                    },
                    SwarmEvent::Behaviour(MyBehaviourEvent::RequestResponse(request_response::Event::Message { 
                        peer, message: request_response::Message::Request { request, channel, .. }, ..
                    })) => {
                        match request {
                            AppRequest::Join { username } => {
                                println!("Join Request from {}: {}", peer, username);
                                pending_invites.lock().unwrap().insert(peer.to_string(), channel);
                                let _ = app_handle.emit("join-requested", peer.to_string());
                            },
                            AppRequest::Sync { data } => {
                                // Received Yjs update from peer
                                let _ = app_handle.emit("p2p-sync", data);
                                let _ = swarm.behaviour_mut().request_response.send_response(channel, AppResponse::Ack);
                            },
                            AppRequest::Ping => {
                                let _ = swarm.behaviour_mut().request_response.send_response(channel, AppResponse::Pong);
                            }
                        }
                    },
                    SwarmEvent::Behaviour(MyBehaviourEvent::RequestResponse(request_response::Event::Message { 
                        peer, message: request_response::Message::Response { response, .. }, ..
                    })) => {
                        match response {
                            AppResponse::Join { accepted, content } => {
                                if accepted {
                                    println!("Joined session with {}", peer);
                                    current_host = Some(peer); 
                                    // Add host to our active list so we broadcast updates back to them
                                    active_peers.lock().unwrap().insert(peer.to_string());
                                    
                                    if let Some(c) = content {
                                        let _ = app_handle.emit("join-accepted", c);
                                    }
                                }
                            },
                            _ => {}
                        }
                    },
                    SwarmEvent::Behaviour(MyBehaviourEvent::RequestResponse(request_response::Event::OutboundFailure { 
                        peer, error, ..
                    })) => {
                         if Some(peer) == current_host {
                            current_host = None;
                            let _ = app_handle.emit("host-disconnected", peer.to_string());
                        }
                        // Remove from active peers on error
                        active_peers.lock().unwrap().remove(&peer.to_string());
                    },
                    _ => {}
                }
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let peers = Arc::new(Mutex::new(HashSet::new()));
    let pending_invites = Arc::new(Mutex::new(HashMap::new()));
    let active_peers = Arc::new(Mutex::new(HashSet::new()));
    
    let (tx, rx) = tokio::sync::mpsc::channel::<(String, Payload)>(32);
    let tx = Arc::new(tokio::sync::Mutex::new(tx));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(PeerState { 
            peers: peers.clone(), 
            pending_invites: pending_invites.clone(),
            active_peers: active_peers.clone() 
        })
        .manage(tx.clone())
        .setup(move |app| {
            let handle = app.handle().clone();
            let peers_s = peers.clone(); 
            let pending_s = pending_invites.clone();
            let active_s = active_peers.clone();
            
            tauri::async_runtime::spawn(async move {
                if let Err(e) = start_p2p_node(handle, peers_s, pending_s, active_s, rx).await {
                    eprintln!("P2P Network Error: {e}");
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            save_content, read_content, get_peers,
            request_join, approve_join, broadcast_update // Registered new command
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}