use clap::Parser;
use libp2p::{
    core::multiaddr::Protocol,
    identify,
    identity,
    noise,
    ping,
    relay,
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

#[derive(NetworkBehaviour)]
struct RelayNodeBehaviour {
    relay: relay::Behaviour,
    identify: identify::Behaviour,
    ping: ping::Behaviour,
}

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    /// The public IP address of this GCP instance
    #[arg(short, long)]
    public_ip: Option<String>,

    /// Port to listen on (default 4001)
    #[arg(short, long, default_value_t = 4001)]
    port: u16,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    env_logger::init();
    let args = Args::parse();

    // 1. Generate Identity
    let id_keys = identity::Keypair::generate_ed25519();
    let local_peer_id = PeerId::from(id_keys.public());
    println!("Local Peer ID: {}", local_peer_id);

    // 2. Configure Behaviours (Relay + Identify + Ping)
    let behaviour = RelayNodeBehaviour {
        // Enable Circuit Relay v2 (Hop)
        relay: relay::Behaviour::new(
            local_peer_id,
            relay::Config {
                max_reservations: 128,
                max_circuits: 16,
                ..Default::default()
            },
        ),
        // Allow peers to identify this node (needed for address discovery)
        identify: identify::Behaviour::new(identify::Config::new(
            "/relay/1.0.0".to_string(),
            id_keys.public(),
        )),
        ping: ping::Behaviour::new(ping::Config::new()),
    };

    // 3. Build Swarm
    let mut swarm = SwarmBuilder::with_existing_identity(id_keys)
        .with_tokio()
        // Support TCP (with Noise + Yamux)
        .with_tcp(
            tcp::Config::default(),
            noise::Config::new,
            yamux::Config::default,
        )?
        // Support QUIC (UDP)
        .with_quic()
        .with_behaviour(|_| behaviour)?
        .with_swarm_config(|c| c.with_idle_connection_timeout(Duration::from_secs(60)))
        .build();

    // 4. Listen on Interfaces (0.0.0.0 binds to all local interfaces)
    let tcp_addr: Multiaddr = format!("/ip4/0.0.0.0/tcp/{}", args.port).parse()?;
    let quic_addr: Multiaddr = format!("/ip4/0.0.0.0/udp/{}/quic-v1", args.port).parse()?;

    swarm.listen_on(tcp_addr)?;
    swarm.listen_on(quic_addr)?;

    // 5. Explicitly announce Public IP if provided
    if let Some(ip) = args.public_ip {
        let public_tcp: Multiaddr = format!("/ip4/{}/tcp/{}", ip, args.port).parse()?;
        let public_quic: Multiaddr = format!("/ip4/{}/udp/{}/quic-v1", ip, args.port).parse()?;
        
        println!("Announcing external address: {}", public_tcp);
        swarm.add_external_address(public_tcp);
        
        println!("Announcing external address: {}", public_quic);
        swarm.add_external_address(public_quic);
    }

    println!("Relay server listening on port {}...", args.port);

    // 6. Event Loop
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