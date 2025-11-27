use tauri::{AppHandle, Emitter, Manager}; 
use std::time::Duration;
use std::fs; 
use libp2p::{
    swarm::{NetworkBehaviour, SwarmEvent, dial_opts::DialOpts},
    SwarmBuilder, PeerId, StreamProtocol, Multiaddr, 
    request_response::{self, ProtocolSupport},
    identity,
    relay::client as relay_client,
    dcutr,
    identify,
    ping,
    core::multiaddr::Protocol,
    noise, // Required for relay transport upgrade
    yamux, // Required for relay transport upgrade
    core::upgrade::Version, // Required for upgrade version
    Transport
};
use tokio::sync::mpsc::Receiver;
use futures::stream::StreamExt; 
use serde::Serialize; 

use crate::protocol::{AppRequest, AppResponse, Payload};
use crate::state::PeerState;

// Ideally this should be configurable, but hardcoded for the demo/request context
const RELAY_ADDRESS: &str = "/ip4/35.212.216.37/udp/4001/quic-v1/p2p/12D3KooWBSXVpDHG2gdQryLEwG9pbiqiuG11M2n85AmvKcxnMwka";

fn get_local_ip() -> Option<std::net::IpAddr> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:53").ok()?;
    socket.local_addr().ok().map(|addr| addr.ip())
}

#[derive(NetworkBehaviour)]
struct MyBehaviour {
    request_response: request_response::json::Behaviour<AppRequest, AppResponse>,
    relay_client: relay_client::Behaviour,
    dcutr: dcutr::Behaviour,
    identify: identify::Behaviour,
    ping: ping::Behaviour,
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

    let local_peer_id = PeerId::from(keypair.public());
    println!("Local Peer ID: {}", local_peer_id);
    *state.local_peer_id.lock().unwrap_or_else(|e| e.into_inner()) = Some(local_peer_id.to_string());
    let _ = app_handle.emit("local-peer-id", local_peer_id.to_string());

    // 1. Create Relay Client
    let (relay_transport, relay_behaviour) = relay_client::new(local_peer_id);

    // 2. Build Swarm with Relay + DCUtR + QUIC
    // We upgrade the relay transport to support noise/yamux so we can drive DCUtR over it.
    let mut swarm = SwarmBuilder::with_existing_identity(keypair)
        .with_tokio()
        .with_quic()
        .with_other_transport(|key| {
            let noise_config = noise::Config::new(key).expect("failed to create noise config");
            let yamux_config = yamux::Config::default();

            relay_transport
                .upgrade(Version::V1)
                .authenticate(noise_config)
                .multiplex(yamux_config)
        })? 
        .with_dns()? 
        .with_behaviour(|key| {
            let request_response = request_response::json::Behaviour::new(
                [(StreamProtocol::new("/collab/1.0.0"), ProtocolSupport::Full)],
                request_response::Config::default()
            );
            
            // Identify is required for DCUtR to exchange public addresses
            let identify = identify::Behaviour::new(identify::Config::new(
                "/collab/1.0.0".to_string(),
                key.public(),
            ));

            Ok(MyBehaviour { 
                request_response,
                relay_client: relay_behaviour,
                dcutr: dcutr::Behaviour::new(local_peer_id),
                identify,
                ping: ping::Behaviour::new(ping::Config::new()),
            })
        })?
        .with_swarm_config(|c| c.with_idle_connection_timeout(Duration::from_secs(60)))
        .build();

    // 3. Listen on Local Interface (QUIC/UDP)
    swarm.listen_on("/ip4/0.0.0.0/udp/0/quic-v1".parse()?)?;

    // 4. Bootstrap: Connect to Relay and Listen via Relay
    if let Ok(relay_addr) = RELAY_ADDRESS.parse::<Multiaddr>() {
        println!("Dialing Relay: {}", relay_addr);
        // A. Dial the relay
        swarm.dial(DialOpts::from(relay_addr.clone()))?;
        
        // B. Listen via the relay (Circuit Relay)
        // This constructs an address like: /ip4/.../p2p/QmRelay/p2p-circuit
        let listen_via_relay = relay_addr.with(Protocol::P2pCircuit);
        println!("Requesting to listen via relay: {}", listen_via_relay);
        swarm.listen_on(listen_via_relay)?;
    } else {
        eprintln!("WARNING: Invalid RELAY_ADDRESS. Hole punching will not work.");
    }

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
                             
                             // 1. Add explicitly provided addresses (e.g., from git meta file)
                             for addr_str in remote_addrs {
                                 if let Ok(addr) = addr_str.parse::<Multiaddr>() {
                                     multiaddrs.push(addr);
                                 }
                             }
                             
                             // 2. Add Relay Circuit Address (Automatic Fallback)
                             // This ensures that if the Guest cannot reach the Host directly (NAT),
                             // we attempt to tunnel through the relay. DCUtR will then upgrade this to a direct link.
                             if let Ok(relay_addr) = RELAY_ADDRESS.parse::<Multiaddr>() {
                                 // Construct: <RelayAddr>/p2p-circuit/p2p/<TargetPeerId>
                                 let circuit_addr = relay_addr
                                    .with(Protocol::P2pCircuit)
                                    .with(Protocol::P2p(peer));
                                 
                                 println!("(Join) Adding Relay Circuit Address: {}", circuit_addr);
                                 multiaddrs.push(circuit_addr);
                             }
                             
                             // Dial with all gathered addresses
                             let opts = DialOpts::peer_id(peer)
                                 .addresses(multiaddrs)
                                 .build();
                             
                             // We ignore errors here; the request_response might queue or fail independently.
                             // Dialing explicitly ensures the Swarm knows the relay path.
                             let _ = swarm.dial(opts);

                             swarm.behaviour_mut().request_response.send_request(
                                 &peer, 
                                 AppRequest::Join { username: "Guest".into() }
                             );
                        }
                    },
                    ("accept", Payload::JoinAccept { peer_id, content }) => {
                        let mut pending = state.pending_invites.lock().unwrap_or_else(|e| e.into_inner());
                        if let Some(channel) = pending.remove(&peer_id) {
                             state.active_peers.lock().unwrap_or_else(|e| e.into_inner()).insert(peer_id.clone());
                             
                             let _ = swarm.behaviour_mut().request_response.send_response(
                                 channel,
                                 AppResponse::Join { accepted: true, content: Some(content) }
                             );
                        }
                    },
                    ("sync", Payload::SyncData { path, data }) => {
                        let targets: Vec<String> = state.active_peers.lock().unwrap_or_else(|e| e.into_inner()).iter().cloned().collect();
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
                         let targets: Vec<String> = state.active_peers.lock().unwrap_or_else(|e| e.into_inner()).iter().cloned().collect();
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
                        let targets: Vec<String> = state.active_peers.lock().unwrap_or_else(|e| e.into_inner()).iter().cloned().collect();
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
                        
                        state.local_addrs.lock().unwrap_or_else(|e| e.into_inner()).push(addr_str.clone());
                        let _ = app_handle.emit("new-listen-addr", addr_str.clone());
                        
                        if addr_str.contains("0.0.0.0") && !addr_str.contains("p2p-circuit") {
                            if let Some(lan_ip) = get_local_ip() {
                                let fixed_addr = addr_str.replace("0.0.0.0", &lan_ip.to_string());
                                println!("Announcing LAN Addr: {}", fixed_addr);
                                
                                state.local_addrs.lock().unwrap_or_else(|e| e.into_inner()).push(fixed_addr.clone());
                                let _ = app_handle.emit("new-listen-addr", fixed_addr);
                            }
                        }
                    },
                    SwarmEvent::Behaviour(MyBehaviourEvent::RelayClient(relay_client::Event::ReservationReqAccepted { .. })) => {
                        println!("Relay accepted our reservation! We are now reachable via the relay.");
                    },
                    // DCUtR Success Event:
                    SwarmEvent::Behaviour(MyBehaviourEvent::Dcutr(dcutr::Event { remote_peer_id, result: Ok(_) })) => {
                        println!("HOLE PUNCH SUCCESS! Connected directly to {}", remote_peer_id);
                    },
                    SwarmEvent::Behaviour(MyBehaviourEvent::RequestResponse(request_response::Event::Message { 
                        peer, message: request_response::Message::Request { request, channel, .. }, ..
                    })) => {
                        match request {
                            AppRequest::Join { username } => {
                                println!("Join Request from {}: {}", peer, username);
                                state.pending_invites.lock().unwrap_or_else(|e| e.into_inner()).insert(peer.to_string(), channel);
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
                                    state.active_peers.lock().unwrap_or_else(|e| e.into_inner()).insert(peer.to_string());
                                    
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
                        state.active_peers.lock().unwrap_or_else(|e| e.into_inner()).remove(&peer.to_string());
                    },
                    _ => {}
                }
            }
        }
    }
}