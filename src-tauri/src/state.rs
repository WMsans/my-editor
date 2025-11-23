use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use libp2p::request_response::ResponseChannel;
use crate::protocol::AppResponse;

#[derive(Clone)]
pub struct PeerState {
    pub pending_invites: Arc<Mutex<HashMap<String, ResponseChannel<AppResponse>>>>,
    pub active_peers: Arc<Mutex<HashSet<String>>>,
    pub local_peer_id: Arc<Mutex<Option<String>>>,
    // ADD THIS: Store local addresses
    pub local_addrs: Arc<Mutex<Vec<String>>>,
}

impl PeerState {
    pub fn new() -> Self {
        Self {
            pending_invites: Arc::new(Mutex::new(HashMap::new())),
            active_peers: Arc::new(Mutex::new(HashSet::new())),
            local_peer_id: Arc::new(Mutex::new(None)),
            // ADD THIS
            local_addrs: Arc::new(Mutex::new(Vec::new())),
        }
    }
}