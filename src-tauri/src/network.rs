use tauri::{AppHandle, Emitter}; // Manager is not strictly needed here if we use AppHandle for emitting
use std::time::Duration;
use libp2p::{
    mdns, noise, tcp, yamux,
    swarm::{NetworkBehaviour, SwarmEvent},
    SwarmBuilder, PeerId, StreamProtocol,
    request_response::{self, ProtocolSupport},
};
use tokio::sync::mpsc::Receiver;
use futures::stream::StreamExt; // Required for select_next_some

use crate::protocol::{AppRequest, AppResponse, Payload};
use crate::state::PeerState;

#[derive(NetworkBehaviour)]
struct MyBehaviour {
    mdns: mdns::tokio::Behaviour,
    request_response: request_response::json::Behaviour<AppRequest, AppResponse>,
}

pub async fn start_p2p_node(
    app_handle: AppHandle,
    state: PeerState, // This contains the Arcs
    mut cmd_rx: Receiver<(String, Payload)>
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
            // 1. Heartbeat
            _ = heartbeat.tick() => {
                if let Some(host_id) = current_host {
                    swarm.behaviour_mut().request_response.send_request(&host_id, AppRequest::Ping);
                }
            }

            // 2. Commands from Frontend (via Channel)
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
                        let mut pending = state.pending_invites.lock().unwrap();
                        if let Some(channel) = pending.remove(&peer_id) {
                             state.active_peers.lock().unwrap().insert(peer_id.clone());
                             
                             let _ = swarm.behaviour_mut().request_response.send_response(
                                 channel,
                                 AppResponse::Join { accepted: true, content: Some(content) }
                             );
                        }
                    },
                    ("sync", Payload::SyncData(data)) => {
                        let targets: Vec<String> = state.active_peers.lock().unwrap().iter().cloned().collect();
                        
                        for peer_str in targets {
                            if let Ok(peer) = peer_str.parse::<PeerId>() {
                                swarm.behaviour_mut().request_response.send_request(
                                    &peer,
                                    AppRequest::Sync { data: data.clone() }
                                );
                            }
                        }
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
            
            // 3. Network Events (mDNS, Requests, etc.)
            event = swarm.select_next_some() => {
                match event {
                    // --- mDNS Discovery ---
                    SwarmEvent::Behaviour(MyBehaviourEvent::Mdns(mdns::Event::Discovered(list))) => {
                        for (peer_id, _) in list {
                            // FIX: Use state.peers directly
                            state.peers.lock().unwrap().insert(peer_id.to_string());
                            let _ = app_handle.emit("peer-discovered", peer_id.to_string());
                        }
                    },
                    SwarmEvent::Behaviour(MyBehaviourEvent::Mdns(mdns::Event::Expired(list))) => {
                        for (peer_id, _) in list {
                            state.peers.lock().unwrap().remove(&peer_id.to_string());
                            let _ = app_handle.emit("peer-expired", peer_id.to_string());
                        }
                    },

                    // --- Request / Response ---
                    SwarmEvent::Behaviour(MyBehaviourEvent::RequestResponse(request_response::Event::Message { 
                        peer, message: request_response::Message::Request { request, channel, .. }, ..
                    })) => {
                        match request {
                            AppRequest::Join { username } => {
                                println!("Join Request from {}: {}", peer, username);
                                state.pending_invites.lock().unwrap().insert(peer.to_string(), channel);
                                let _ = app_handle.emit("join-requested", peer.to_string());
                            },
                            AppRequest::Sync { data } => {
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