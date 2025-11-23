use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileSyncEntry {
    pub path: String,
    pub content: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum AppRequest {
    Join { username: String },
    Sync { path: String, data: Vec<u8> },
    FileContent { path: String, data: Vec<u8> },
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
    // CHANGED: Now includes a list of remote_addrs to try
    JoinCall { peer_id: String, remote_addrs: Vec<String> }, 
    JoinAccept { peer_id: String, content: Vec<u8> },
    SyncData { path: String, data: Vec<u8> },
    FileContent { path: String, data: Vec<u8> },
    RequestSync { path: String },
}