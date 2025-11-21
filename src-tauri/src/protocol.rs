use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum AppRequest {
    Join { username: String },
    Sync { data: Vec<u8> },
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
    SyncData(Vec<u8>),
}