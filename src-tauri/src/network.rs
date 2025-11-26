use tauri::{Manager}; 
use std::time::Duration;
use std::fs; 
use libp2p::{
    autonat, identify, noise, ping, tcp, yamux, relay, dcutr,
    swarm::{NetworkBehaviour, SwarmEvent, dial_opts::DialOpts},
    SwarmBuilder, PeerId, StreamProtocol, Multiaddr, 
    request_response::{self, ProtocolSupport},
    identity, 
    Transport, core::upgrade 
};
use tokio::sync::mpsc::Receiver;
use futures::stream::StreamExt; 
use serde::Serialize; 
use std::path::PathBuf;

use crate::protocol::{AppRequest, AppResponse, Payload};
use crate::state::PeerState;

pub trait PeerHost {
    fn emit<T: Serialize + Clone + Send>(&self, event: &str, payload: T);
    fn get_app_data_dir(&self) -> PathBuf;
}

impl PeerHost for tauri::AppHandle {
    fn emit<T: Serialize + Clone + Send>(&self, event: &str, payload: T) {
        let _ = tauri::Emitter::emit(self, event, payload);
    }
    fn get_app_data_dir(&self) -> PathBuf {
        self.path().app_data_dir().unwrap_or_else(|_| PathBuf::from("."))
    }
}

fn get_local_ip() -> Option<std::net::IpAddr> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    socket.local_addr().ok().map(|addr| addr.ip())
}

#[derive(NetworkBehaviour)]
struct MyBehaviour {
    relay_server: relay::Behaviour,
    relay_client: relay::client::Behaviour,
    dcutr: dcutr::Behaviour,
    request_response: request_response::json::Behaviour<AppRequest, AppResponse>,
    identify: identify::Behaviour,
    autonat: autonat::Behaviour,
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

pub async fn start_p2p_node<H: PeerHost + Send + Sync + 'static>(
    host: H, 
    state: PeerState, 
    mut cmd_rx: Receiver<(String, Payload)>,
    public_ip: Option<String>,
    boot_nodes: Vec<String>,
) -> Result<(), Box<dyn std::error::Error>> {
    
    let app_data_dir = host.get_app_data_dir();    
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

    let local_peer_id = keypair.public().to_peer_id();
    println!("Local Peer ID: {}", local_peer_id);
    *state.local_peer_id.lock().unwrap_or_else(|e| e.into_inner()) = Some(local_peer_id.to_string());
    let _ = host.emit("local-peer-id", local_peer_id.to_string());

    let (relay_transport, relay_client) = relay::client::new(local_peer_id);

    let transport = {
        // [FIXED] Removed .keepalive() as it caused compilation error. 
        // We rely on app-level ping for keeping NAT alive.
        let tcp_config = tcp::Config::default()
            .nodelay(true);

        let tcp_transport = tcp::tokio::Transport::new(tcp_config);
        
        let dns_transport = libp2p::dns::tokio::Transport::system(tcp_transport)?;

        dns_transport.or_transport(relay_transport)
            .upgrade(upgrade::Version::V1)
            .authenticate(noise::Config::new(&keypair)?)
            .multiplex(yamux::Config::default())
            .boxed()
    };

    let mut swarm = SwarmBuilder::with_existing_identity(keypair)
        .with_tokio()
        .with_other_transport(|_| transport)? 
        .with_dns()?
        .with_behaviour(|key| {
            let relay_server = relay::Behaviour::new(
                key.public().to_peer_id(),
                relay::Config::default(),
            );

            let dcutr = dcutr::Behaviour::new(key.public().to_peer_id());

            let request_response = request_response::json::Behaviour::new(
                [(StreamProtocol::new("/collab/1.0.0"), ProtocolSupport::Full)],
                request_response::Config::default()
            );

            let identify = identify::Behaviour::new(identify::Config::new(
                "/collab/1.0.0".to_string(),
                key.public().clone(),
            ));

            let autonat_config = if public_ip.is_some() {
                 autonat::Config {
                    only_global_ips: false, 
                    ..Default::default()
                 }
            } else {
                autonat::Config::default()
            };
            
            let autonat = autonat::Behaviour::new(key.public().to_peer_id(), autonat_config);
            // Lower ping interval to keep NAT mapping fresh
            let ping = ping::Behaviour::new(ping::Config::new().with_interval(Duration::from_secs(15)));

            Ok(MyBehaviour {
                relay_server,
                relay_client, 
                dcutr,
                request_response,
                identify,
                autonat,
                ping,
            })
        })?
        .with_swarm_config(|c| c.with_idle_connection_timeout(Duration::from_secs(60)))
        .build();

    swarm.listen_on("/ip4/0.0.0.0/tcp/4001".parse()?)?;

    if let Some(ip) = public_ip {
        let external_addr: Multiaddr = format!("/ip4/{}/tcp/4001", ip).parse()?;
        println!("🌍 Announcing External Address: {}", external_addr);
        swarm.add_external_address(external_addr);
    }

    // --- CONNECTION LOGIC EXTRACTED ---
    let boot_nodes_clone = boot_nodes.clone();
    
    // Initial Dial
    for bootnode in &boot_nodes { 
        if let Ok(addr) = bootnode.parse::<Multiaddr>() {
            let _ = swarm.dial(addr);
        }
    }

    let mut current_host: Option<PeerId> = None;
    let mut heartbeat = tokio::time::interval(Duration::from_secs(3));
    let mut check_relay_conn = tokio::time::interval(Duration::from_secs(10));

    loop {
        tokio::select! {
            _ = heartbeat.tick() => {
                if let Some(host_id) = current_host {
                    swarm.behaviour_mut().request_response.send_request(&host_id, AppRequest::Ping);
                }
            }

            // --- RECONNECT LOOP ---
            _ = check_relay_conn.tick() => {
                let connected_peers = swarm.network_info().num_peers();
                if connected_peers == 0 {
                    println!("⚠ No peers connected. Attempting to reconnect to Bootnodes...");
                    for bootnode in &boot_nodes_clone { 
                        if let Ok(addr) = bootnode.parse::<Multiaddr>() {
                             let _ = swarm.dial(addr);
                        }
                    }
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
                    SwarmEvent::ConnectionEstablished { peer_id, .. } => {
                        let _ = host.emit("peer-connected", peer_id.to_string());
                        if boot_nodes.iter().any(|addr| addr.contains(&peer_id.to_string())) {
                            println!("🔗 Connected to Bootnode Relay! Enabling circuit listen...");
                            
                            let circuit_addr_str = format!("/p2p/{}/p2p-circuit", peer_id);
                            let circuit_addr = circuit_addr_str.parse::<Multiaddr>();
                                
                            if let Ok(addr) = circuit_addr {
                                let _ = swarm.listen_on(addr);
                                host.emit("new-listen-addr", circuit_addr_str.clone());
                                state.lan_addrs.lock().unwrap_or_else(|e| e.into_inner()).push(circuit_addr_str);
                            }
                        }
                    },
                    SwarmEvent::Behaviour(MyBehaviourEvent::RelayClient(
                        relay::client::Event::ReservationReqAccepted { .. }
                    )) => {
                        println!("✅ Relay Reservation Accepted! We are now reachable via the Bootnode.");
                    },
                    SwarmEvent::Behaviour(MyBehaviourEvent::Dcutr(dcutr::Event { remote_peer_id, result })) => {
                        match result {
                            Ok(_) => {
                                println!("⚡⚡⚡ HOLE PUNCH SUCCESS! Direct connection to {} ⚡⚡⚡", remote_peer_id);
                            }
                            Err(e) => {
                                println!("⚡ DCUtR Hole Punch failed for {}: {:?}", remote_peer_id, e);
                            }
                        }
                    },
                    SwarmEvent::NewListenAddr { address, .. } => {
                        let addr_str = address.to_string();
                        state.lan_addrs.lock().unwrap_or_else(|e| e.into_inner()).push(addr_str.clone());
                        
                        host.emit("new-listen-addr", addr_str.clone());
                        
                        if addr_str.contains("0.0.0.0") {
                            if let Some(lan_ip) = get_local_ip() {
                                let fixed_addr = addr_str.replace("0.0.0.0", &lan_ip.to_string());
                                host.emit("new-listen-addr", fixed_addr); 
                            }
                        }
                    },
                    SwarmEvent::ExternalAddrConfirmed { address } => {
                        let addr_str = address.to_string();
                        println!("External address confirmed: {}", addr_str);

                        let mut is_global = false;
                        for proto in address.iter() {
                            match proto {
                                libp2p::multiaddr::Protocol::Ip4(ip) => {
                                    if !ip.is_loopback() && !ip.is_private() && !ip.is_link_local() {
                                        is_global = true;
                                        break;
                                    }
                                }
                                libp2p::multiaddr::Protocol::Ip6(ip) => {
                                    if !ip.is_loopback() {
                                        is_global = true;
                                        break;
                                    }
                                }
                                _ => {}
                            }
                        }

                        if is_global {
                             state.wan_addrs.lock().unwrap_or_else(|e| e.into_inner()).push(addr_str.clone());
                             let _ = host.emit("public-ip-found", addr_str);
                        }
                    },
                    SwarmEvent::Behaviour(MyBehaviourEvent::Autonat(event)) => {
                        match event {
                            libp2p::autonat::Event::StatusChanged { old, new } => {
                                println!("AutoNAT Status Changed: {:?} -> {:?}", old, new);
                            }
                            _ => {}
                        }
                    },
                    SwarmEvent::ConnectionClosed { peer_id, .. } => {
                        println!("❌ Disconnected from: {}", peer_id);
                        let _ = host.emit("peer-disconnected", peer_id.to_string());
                    },
                    SwarmEvent::OutgoingConnectionError { error, .. } => {
                        println!("🚨 Failed to connect to bootnode: {:?}", error);
                    },
                    SwarmEvent::Behaviour(MyBehaviourEvent::RequestResponse(request_response::Event::Message { 
                        peer, message: request_response::Message::Request { request, channel, .. }, ..
                    })) => {
                        match request {
                            AppRequest::Join { username } => {
                                println!("Join Request from {}: {}", peer, username);
                                state.pending_invites.lock().unwrap_or_else(|e| e.into_inner()).insert(peer.to_string(), channel);
                                let _ = host.emit("join-requested", peer.to_string());
                            },
                            AppRequest::Sync { path, data } => {
                                let _ = host.emit("p2p-sync", SyncEvent { path, data });
                                let _ = swarm.behaviour_mut().request_response.send_response(channel, AppResponse::Ack);
                            },
                            AppRequest::RequestSync { path } => {
                                let _ = host.emit("sync-requested", SyncRequestEvent { path });
                                let _ = swarm.behaviour_mut().request_response.send_response(channel, AppResponse::Ack);
                            },
                            AppRequest::FileContent { path, data } => {
                                let _ = host.emit("p2p-file-content", FileContentEvent { path, data });
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
                                        let _ = host.emit("join-accepted", c);
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
                            let _ = host.emit("host-disconnected", peer.to_string());
                        }
                        state.active_peers.lock().unwrap_or_else(|e| e.into_inner()).remove(&peer.to_string());
                    },
                    _ => {}
                }
            }
        }
    }
}