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
struct JoinRequest {
    username: String, // Identify who is asking
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct JoinResponse {
    accepted: bool,
    content: Option<String>, // Send the world state if accepted
}

// --- 2. Update State to store pending invites ---
// We need to hold the "ResponseChannel" in memory while waiting for the user to click "Accept"
struct PeerState {
    peers: Arc<Mutex<HashSet<String>>>,
    // Map PeerId string -> ResponseChannel so we can reply later
    pending_invites: Arc<Mutex<HashMap<String, request_response::ResponseChannel<JoinResponse>>>>,
}

#[derive(NetworkBehaviour)]
struct MyBehaviour {
    mdns: mdns::tokio::Behaviour,
    request_response: request_response::json::Behaviour<JoinRequest, JoinResponse>,
}

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

// --- 3. New Commands for the Handshake ---

#[command]
async fn request_join_peer(
    peer_id: String, 
    app_handle: AppHandle, 
    state: State<'_, PeerState>
) -> Result<(), String> {
    // In a real app, we'd send this message into the swarm channel. 
    // For simplicity here, we will emit an event to the background task or use a channel.
    // *Note: Communicating with the running Swarm from a Command requires a thread-safe channel (mpsc).*
    // *Since we don't have that set up in this simple snippet, we will need to restructure slightly to pass commands to the swarm.*
    // *For this example, I will assume we emit an event that the frontend sees, OR (better) we use tauri's event system to signal the loop.*
    
    // PROPER IMPLEMENTATION requires an mpsc channel to the swarm loop. 
    // See "Step 4" below for how we handle this triggering.
    let _ = app_handle.emit("cmd-send-request", peer_id);
    Ok(())
}

#[command]
fn respond_to_join(
    peer_id: String, 
    accepted: bool, 
    current_content: String,
    state: State<'_, PeerState>
) -> Result<(), String> {
    let mut pending = state.pending_invites.lock().map_err(|e| e.to_string())?;
    
    if let Some(channel) = pending.remove(&peer_id) {
        // We need to send this response. 
        // Again, we need to pass this 'channel' + 'response' back to the swarm.
        // Since 'channel' is not serializable, we actually should have the Swarm 
        // check this shared state map periodically or use a channel.
        // For this simplified version, we will signal the swarm to check the map.
        
        // We store the decision in a way the Swarm can find it, 
        // OR (Better) we emit a Tauri event that the Swarm loop is listening to? 
        // No, Swarm is in a loop.
        
        // SOLUTION: We will use a specialized mpsc channel in the 'setup' block.
        // But to keep your code copy-pasteable, we'll use the "Shared State" trick 
        // where the Swarm loop checks a "Outbox" queue.
        
        // For now, let's update the state and let the loop handle it (see step 4).
        return Ok(());
    }
    Err("No pending request found for this peer".to_string())
}

// --- 4. The Network Loop ---

async fn start_p2p_node(
    app_handle: AppHandle, 
    peers_state: Arc<Mutex<HashSet<String>>>,
    pending_invites: Arc<Mutex<HashMap<String, request_response::ResponseChannel<JoinResponse>>>>,
    // In a real app, pass a Receiver here to handle commands from the frontend
    mut cmd_rx: tokio::sync::mpsc::Receiver<(String, String)> // (Command, Payload)
) -> Result<(), Box<dyn std::error::Error>> {

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
            
            let request_response = request_response::json::Behaviour::new(
                [(StreamProtocol::new("/collab/1.0.0"), ProtocolSupport::Full)],
                request_response::Config::default()
            );

            Ok(MyBehaviour { mdns, request_response })
        })?
        .with_swarm_config(|c| c.with_idle_connection_timeout(Duration::from_secs(60)))
        .build();

    swarm.listen_on("/ip4/0.0.0.0/tcp/0".parse()?)?;

    loop {
        tokio::select! {
            // Handle commands from Frontend (via mpsc channel)
            Some((cmd, payload)) = cmd_rx.recv() => {
                if cmd == "join" {
                    if let Ok(peer) = payload.parse::<PeerId>() {
                         swarm.behaviour_mut().request_response.send_request(
                             &peer, 
                             JoinRequest { username: "Guest".into() } 
                         );
                    }
                } else if cmd == "accept" {
                     // payload is formatted as "PEER_ID|CONTENT"
                     if let Some((peer_str, content)) = payload.split_once('|') {
                         let mut pending = pending_invites.lock().unwrap();
                         if let Some(channel) = pending.remove(peer_str) {
                             let _ = swarm.behaviour_mut().request_response.send_response(
                                 channel,
                                 JoinResponse { accepted: true, content: Some(content.to_string()) }
                             );
                         }
                     }
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
                    // --- Handle Incoming Join Request ---
                    SwarmEvent::Behaviour(MyBehaviourEvent::RequestResponse(request_response::Event::Message { 
                        peer, 
                        message: request_response::Message::Request { request, channel, .. },
                        ..
                    })) => {
                        println!("Received request from {peer}: {:?}", request);
                        
                        // 1. Store the channel so we can reply later
                        pending_invites.lock().unwrap().insert(peer.to_string(), channel);
                        
                        // 2. Notify Frontend to show "Accept/Reject" UI
                        let _ = app_handle.emit("join-requested", peer.to_string());
                    },
                    // --- Handle Join Response (As Guest) ---
                    SwarmEvent::Behaviour(MyBehaviourEvent::RequestResponse(request_response::Event::Message { 
                        peer, 
                        message: request_response::Message::Response { response, .. },
                        ..
                    })) => {
                        if response.accepted {
                            println!("Join accepted by {peer}!");
                            // Emit event with the content to load into the editor
                            let _ = app_handle.emit("join-accepted", response.content.unwrap_or_default());
                        } else {
                            println!("Join rejected.");
                        }
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
    
    // Create a channel to send commands from Tauri commands -> Swarm Loop
    let (tx, rx) = tokio::sync::mpsc::channel::<(String, String)>(32);
    let tx = Arc::new(tokio::sync::Mutex::new(tx));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(PeerState { peers: peers.clone(), pending_invites: pending_invites.clone() })
        .manage(tx.clone()) // Manage the sender
        .setup(move |app| {
            let handle = app.handle().clone();
            let peers_state = peers.clone(); 
            let pending = pending_invites.clone();
            
            tauri::async_runtime::spawn(async move {
                if let Err(e) = start_p2p_node(handle, peers_state, pending, rx).await {
                    eprintln!("P2P Network Error: {e}");
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            save_content, 
            read_content,
            get_peers,
            request_join, // New handler wrapper
            approve_join  // New handler wrapper
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// Wrapper commands to send data to the channel
#[command]
async fn request_join(peer_id: String, sender: State<'_, Arc<tokio::sync::Mutex<tokio::sync::mpsc::Sender<(String, String)>>>>) -> Result<(), String> {
    let tx = sender.lock().await;
    tx.send(("join".to_string(), peer_id)).await.map_err(|e| e.to_string())
}

#[command]
async fn approve_join(peer_id: String, content: String, sender: State<'_, Arc<tokio::sync::Mutex<tokio::sync::mpsc::Sender<(String, String)>>>>) -> Result<(), String> {
    let tx = sender.lock().await;
    // Combine peer and content to pass through the channel
    let payload = format!("{}|{}", peer_id, content);
    tx.send(("accept".to_string(), payload)).await.map_err(|e| e.to_string())
}