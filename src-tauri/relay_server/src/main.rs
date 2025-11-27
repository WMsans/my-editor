use clap::Parser;
use libp2p::{
    core::multiaddr::Protocol,
    identify,
    identity,
    noise,
    ping,
    relay,
    connection_limits, 
    SwarmBuilder,
    swarm::{NetworkBehaviour, SwarmEvent},
    tcp,
    yamux,
    Multiaddr, PeerId, StreamProtocol,
    futures::StreamExt
};
use std::error::Error;
use std::net::Ipv4Addr;
use std::time::Duration;

// 1. Add limits to your Behaviour Struct
#[derive(NetworkBehaviour)]
struct RelayNodeBehaviour {
    relay: relay::Behaviour,
    identify: identify::Behaviour,
    ping: ping::Behaviour,
    limits: connection_limits::Behaviour, // <--- Added here
}

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    #[arg(short, long)]
    public_ip: Option<String>,
    #[arg(short, long, default_value_t = 4001)]
    port: u16,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    env_logger::init();
    let args = Args::parse();

    let id_keys = identity::Keypair::generate_ed25519();
    let local_peer_id = PeerId::from(id_keys.public());
    println!("Local Peer ID: {}", local_peer_id);

    // 2. Define the Limits
    let limits = connection_limits::ConnectionLimits::default()
        .with_max_pending_incoming(Some(10))
        .with_max_established_incoming(Some(50))
        .with_max_established_per_peer(Some(2));

    let behaviour = RelayNodeBehaviour {
        relay: relay::Behaviour::new(
            local_peer_id,
            relay::Config {
                max_reservations: 32,
                max_circuits: 4,
                reservation_duration: Duration::from_secs(30 * 60),
                max_circuit_duration: Duration::from_secs(2 * 60),
                max_circuit_bytes: 10 * 1024 * 1024, 
                ..Default::default()
            },
        ),
        identify: identify::Behaviour::new(identify::Config::new(
            "/relay/1.0.0".to_string(),
            id_keys.public(),
        )),
        ping: ping::Behaviour::new(ping::Config::new()),
        // 3. Initialize the Behaviour with the limits
        limits: connection_limits::Behaviour::new(limits), 
    };

    let mut swarm = SwarmBuilder::with_existing_identity(id_keys)
        .with_tokio()
        .with_tcp(
            tcp::Config::default(),
            noise::Config::new,
            yamux::Config::default,
        )?
        .with_quic()
        .with_behaviour(|_| behaviour)?
        .with_swarm_config(|c| c.with_idle_connection_timeout(Duration::from_secs(60)))
        // REMOVED: .with_connection_limits(limits) <-- This caused the error
        .build();

    let tcp_addr: Multiaddr = format!("/ip4/0.0.0.0/tcp/{}", args.port).parse()?;
    let quic_addr: Multiaddr = format!("/ip4/0.0.0.0/udp/{}/quic-v1", args.port).parse()?;

    swarm.listen_on(tcp_addr)?;
    swarm.listen_on(quic_addr)?;

    if let Some(ip) = args.public_ip {
        let public_tcp: Multiaddr = format!("/ip4/{}/tcp/{}", ip, args.port).parse()?;
        let public_quic: Multiaddr = format!("/ip4/{}/udp/{}/quic-v1", ip, args.port).parse()?;
        
        println!("Announcing external address: {}", public_tcp);
        swarm.add_external_address(public_tcp);
        
        println!("Announcing external address: {}", public_quic);
        swarm.add_external_address(public_quic);
    }

    println!("Relay server listening on port {}...", args.port);

    loop {
        match swarm.select_next_some().await {
            SwarmEvent::NewListenAddr { address, .. } => {
                println!("Listening locally on: {}", address);
            }
            SwarmEvent::Behaviour(RelayNodeBehaviourEvent::Relay(
                relay::Event::ReservationReqAccepted { src_peer_id, .. },
            )) => {
                println!("Relay accepted reservation from: {}", src_peer_id);
            }
            SwarmEvent::Behaviour(RelayNodeBehaviourEvent::Relay(
                relay::Event::CircuitReqAccepted { src_peer_id, dst_peer_id, .. },
            )) => {
                println!("Relay accepted circuit: {} -> {}", src_peer_id, dst_peer_id);
            }
            _ => {}
        }
    }
}