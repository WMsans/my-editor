use tauri::{command, State};
use std::sync::Arc;
use tokio::sync::Mutex;
use crate::protocol::Payload;
use crate::state::PeerState;

// FIX: Added <'a> to the type alias definition
type SenderState<'a> = State<'a, Arc<Mutex<tokio::sync::mpsc::Sender<(String, Payload)>>>>;

#[command]
pub fn get_peers(state: State<'_, PeerState>) -> Result<Vec<String>, String> {
    let peers = state.peers.lock().map_err(|e| e.to_string())?;
    Ok(peers.iter().cloned().collect())
}

#[command]
pub async fn request_join(
    peer_id: String, 
    sender: SenderState<'_> // FIX: Use the alias with the wildcard here
) -> Result<(), String> {
    let tx = sender.lock().await;
    tx.send(("join".to_string(), Payload::PeerId(peer_id))).await.map_err(|e| e.to_string())
}

#[command]
pub async fn approve_join(
    peer_id: String, 
    content: Vec<u8>, 
    sender: SenderState<'_> // FIX: Use the alias with the wildcard here
) -> Result<(), String> {
    let tx = sender.lock().await;
    tx.send(("accept".to_string(), Payload::JoinAccept { peer_id, content })).await.map_err(|e| e.to_string())
}

#[command]
pub async fn broadcast_update(
    data: Vec<u8>, 
    sender: SenderState<'_> // FIX: Use the alias with the wildcard here
) -> Result<(), String> {
    let tx = sender.lock().await;
    tx.send(("sync".to_string(), Payload::SyncData(data))).await.map_err(|e| e.to_string())
}