use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileSyncEntry {
    pub path: String,
    pub content: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum AppRequest {
    Join { username: String },
    // Added path to Sync request
    Sync { path: String, data: Vec<u8> },
    // NEW: Request full state for a file
    RequestSync { path: String },
    Ping,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum AppResponse {
    Join { accepted: bool, content: Option<Vec<u8>> },
    Ack,
    Pong,
}

#[derive(Debug, Clone)]
pub enum Payload {
    PeerId(String),
    JoinAccept { peer_id: String, content: Vec<u8> },
    // Changed SyncData to struct variant with path
    SyncData { path: String, data: Vec<u8> },
    // NEW: Command payload
    RequestSync { path: String },
}