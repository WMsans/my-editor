use tauri::{AppHandle, Emitter, Manager}; 
use std::time::Duration;
use std::fs; 
use libp2p::{
    noise, tcp, yamux,
    swarm::{NetworkBehaviour, SwarmEvent, dial_opts::DialOpts},
    SwarmBuilder, PeerId, StreamProtocol, Multiaddr, 
    request_response::{self, ProtocolSupport},
    identity, 
};
use tokio::sync::mpsc::Receiver;
use futures::stream::StreamExt; 
use serde::Serialize; 

use crate::protocol::{AppRequest, AppResponse, Payload};
use crate::state::PeerState;

// NEW: Helper to find local LAN IP
fn get_local_ip() -> Option<std::net::IpAddr> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    // We don't actually send data, just determining the route to a public IP
    socket.connect("8.8.8.8:80").ok()?;
    socket.local_addr().ok().map(|addr| addr.ip())
}

#[derive(NetworkBehaviour)]
struct MyBehaviour {
    request_response: request_response::json::Behaviour<AppRequest, AppResponse>,
}

#[derive(Serialize, Clone)]
struct SyncEvent {
    path: String,
    data: Vec<u8>,
}

#[derive(Serialize, Clone)]
struct SyncRequestEvent {
    path: String,
}

#[derive(Serialize, Clone)]
struct FileContentEvent {
    path: String,
    data: Vec<u8>,
}

pub async fn start_p2p_node(
    app_handle: AppHandle,
    state: PeerState, 
    mut cmd_rx: Receiver<(String, Payload)>
) -> Result<(), Box<dyn std::error::Error>> {
    
    let app_data_dir = app_handle.path().app_data_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
    fs::create_dir_all(&app_data_dir)?;
    let identity_path = app_data_dir.join("peer_identity");

    let keypair = if identity_path.exists() {
        let bytes = fs::read(&identity_path)?;
        identity::Keypair::from_protobuf_encoding(&bytes)?
    } else {
        let key = identity::Keypair::generate_ed25519();
        fs::write(&identity_path, key.to_protobuf_encoding()?)?;
        key
    };

    let mut swarm = SwarmBuilder::with_existing_identity(keypair)
        .with_tokio()
        .with_tcp(tcp::Config::default(), noise::Config::new, yamux::Config::default)?
        .with_behaviour(|_key| {
            let request_response = request_response::json::Behaviour::new(
                [(StreamProtocol::new("/collab/1.0.0"), ProtocolSupport::Full)],
                request_response::Config::default()
            );
            Ok(MyBehaviour { request_response })
        })?
        .with_swarm_config(|c| c.with_idle_connection_timeout(Duration::from_secs(60)))
        .build();

    let local_peer_id = swarm.local_peer_id().to_string();
    println!("Local Peer ID: {}", local_peer_id);
    *state.local_peer_id.lock().unwrap() = Some(local_peer_id.clone());
    let _ = app_handle.emit("local-peer-id", local_peer_id);

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
                    ("join", Payload::JoinCall { peer_id: peer_str, remote_addrs }) => {
                        if let Ok(peer) = peer_str.parse::<PeerId>() {
                             let mut multiaddrs = Vec::new();
                             for addr_str in remote_addrs {
                                 if let Ok(addr) = addr_str.parse::<Multiaddr>() {
                                     multiaddrs.push(addr);
                                 }
                             }
                             
                             if !multiaddrs.is_empty() {
                                 let opts = DialOpts::peer_id(peer)
                                     .addresses(multiaddrs)
                                     .build();
                                 let _ = swarm.dial(opts);
                             }

                            swarm.behaviour_mut().request_response.send_request(
                                &peer, 
                                AppRequest::Join { username: "Guest".into() }
                            );
                        }
                    },
                    ("accept", Payload::JoinAccept { peer_id, content }) => {
                        let mut pending = state.pending_invites.lock().unwrap();
                        if let Some(channel) = pending.remove(&peer_id) {
                             state.active_peers.lock().unwrap().insert(peer_id.clone());
                             
                             let _ = swarm.behaviour_mut().request_response.send_response(
                                 channel,
                                 AppResponse::Join { accepted: true, content: Some(content) }
                             );
                        }
                    },
                    ("sync", Payload::SyncData { path, data }) => {
                        let targets: Vec<String> = state.active_peers.lock().unwrap().iter().cloned().collect();
                        
                        for peer_str in targets {
                            if let Ok(peer) = peer_str.parse::<PeerId>() {
                                swarm.behaviour_mut().request_response.send_request(
                                    &peer,
                                    AppRequest::Sync { path: path.clone(), data: data.clone() }
                                );
                            }
                        }
                        if let Some(host) = current_host {
                            swarm.behaviour_mut().request_response.send_request(
                                &host,
                                AppRequest::Sync { path: path.clone(), data: data.clone() }
                            );
                        }
                    },
                    ("request_sync", Payload::RequestSync { path }) => {
                        let targets: Vec<String> = state.active_peers.lock().unwrap().iter().cloned().collect();
                         for peer_str in targets {
                            if let Ok(peer) = peer_str.parse::<PeerId>() {
                                swarm.behaviour_mut().request_response.send_request(
                                    &peer,
                                    AppRequest::RequestSync { path: path.clone() }
                                );
                            }
                        }
                        if let Some(host) = current_host {
                            swarm.behaviour_mut().request_response.send_request(
                                &host,
                                AppRequest::RequestSync { path: path.clone() }
                            );
                        }
                    },
                    ("file_content", Payload::FileContent { path, data }) => {
                        let targets: Vec<String> = state.active_peers.lock().unwrap().iter().cloned().collect();
                        for peer_str in targets {
                            if let Ok(peer) = peer_str.parse::<PeerId>() {
                                swarm.behaviour_mut().request_response.send_request(
                                    &peer,
                                    AppRequest::FileContent { path: path.clone(), data: data.clone() }
                                );
                            }
                        }
                         if let Some(host) = current_host {
                            swarm.behaviour_mut().request_response.send_request(
                                &host,
                                AppRequest::FileContent { path: path.clone(), data: data.clone() }
                            );
                        }
                    },
                    _ => {}
                }
            }
            
            event = swarm.select_next_some() => {
                match event {
                    SwarmEvent::NewListenAddr { address, .. } => {
                        let addr_str = address.to_string();
                        println!("Listening on {}", addr_str);
                        
                        // ADD THIS: Save raw address
                        state.local_addrs.lock().unwrap().push(addr_str.clone());
                        
                        let _ = app_handle.emit("new-listen-addr", addr_str.clone());
                        
                        if addr_str.contains("0.0.0.0") {
                            if let Some(lan_ip) = get_local_ip() {
                                let fixed_addr = addr_str.replace("0.0.0.0", &lan_ip.to_string());
                                println!("Announcing LAN Addr: {}", fixed_addr);
                                
                                // ADD THIS: Save LAN address
                                state.local_addrs.lock().unwrap().push(fixed_addr.clone());
                                
                                let _ = app_handle.emit("new-listen-addr", fixed_addr);
                            }
                        }
                    },
                    SwarmEvent::Behaviour(MyBehaviourEvent::RequestResponse(request_response::Event::Message { 
                        peer, message: request_response::Message::Request { request, channel, .. }, ..
                    })) => {
                        match request {
                            AppRequest::Join { username } => {
                                println!("Join Request from {}: {}", peer, username);
                                state.pending_invites.lock().unwrap().insert(peer.to_string(), channel);
                                let _ = app_handle.emit("join-requested", peer.to_string());
                            },
                            AppRequest::Sync { path, data } => {
                                let _ = app_handle.emit("p2p-sync", SyncEvent { path, data });
                                let _ = swarm.behaviour_mut().request_response.send_response(channel, AppResponse::Ack);
                            },
                            AppRequest::RequestSync { path } => {
                                let _ = app_handle.emit("sync-requested", SyncRequestEvent { path });
                                let _ = swarm.behaviour_mut().request_response.send_response(channel, AppResponse::Ack);
                            },
                            AppRequest::FileContent { path, data } => {
                                let _ = app_handle.emit("p2p-file-content", FileContentEvent { path, data });
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
                                    state.active_peers.lock().unwrap().insert(peer.to_string());
                                    
                                    if let Some(c) = content {
                                        let _ = app_handle.emit("join-accepted", c);
                                    }
                                }
                            },
                            _ => {}
                        }
                    },
                    SwarmEvent::Behaviour(MyBehaviourEvent::RequestResponse(request_response::Event::OutboundFailure { 
                        peer, error: _, ..
                    })) => {
                         if Some(peer) == current_host {
                            current_host = None;
                            let _ = app_handle.emit("host-disconnected", peer.to_string());
                        }
                        state.active_peers.lock().unwrap().remove(&peer.to_string());
                    },
                    _ => {}
                }
            }
        }
    }
}