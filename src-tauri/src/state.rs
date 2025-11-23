use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use libp2p::request_response::ResponseChannel;
use crate::protocol::AppResponse;

#[derive(Clone)]
pub struct PeerState {
    pub peers: Arc<Mutex<HashSet<String>>>,
    pub pending_invites: Arc<Mutex<HashMap<String, ResponseChannel<AppResponse>>>>,
    pub active_peers: Arc<Mutex<HashSet<String>>>,
    // NEW: Field for local peer ID
    pub local_peer_id: Arc<Mutex<Option<String>>>,
}

impl PeerState {
    pub fn new() -> Self {
        Self {
            peers: Arc::new(Mutex::new(HashSet::new())),
            pending_invites: Arc::new(Mutex::new(HashMap::new())),
            active_peers: Arc::new(Mutex::new(HashSet::new())),
            local_peer_id: Arc::new(Mutex::new(None)),
        }
    }
}