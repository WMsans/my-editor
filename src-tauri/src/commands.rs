use tauri::{command, State};
use std::sync::Arc;
use tokio::sync::Mutex;
use crate::protocol::Payload;
use crate::state::PeerState;
use std::fs;
use std::path::Path;
use serde::Serialize;

// Existing type alias
type SenderState<'a> = State<'a, Arc<Mutex<tokio::sync::mpsc::Sender<(String, Payload)>>>>;

// --- New File System Structs ---
#[derive(Serialize, Clone)]
pub struct FileEntry {
    name: String,
    path: String,
    is_dir: bool,
}

// --- Existing Commands ---
#[command]
pub fn get_peers(state: State<'_, PeerState>) -> Result<Vec<String>, String> {
    let peers = state.peers.lock().map_err(|e| e.to_string())?;
    Ok(peers.iter().cloned().collect())
}

#[command]
pub async fn request_join(
    peer_id: String, 
    sender: SenderState<'_> 
) -> Result<(), String> {
    let tx = sender.lock().await;
    tx.send(("join".to_string(), Payload::PeerId(peer_id))).await.map_err(|e| e.to_string())
}

#[command]
pub async fn approve_join(
    peer_id: String, 
    content: Vec<u8>, 
    sender: SenderState<'_>
) -> Result<(), String> {
    let tx = sender.lock().await;
    tx.send(("accept".to_string(), Payload::JoinAccept { peer_id, content })).await.map_err(|e| e.to_string())
}

#[command]
pub async fn broadcast_update(
    data: Vec<u8>, 
    sender: SenderState<'_>
) -> Result<(), String> {
    let tx = sender.lock().await;
    tx.send(("sync".to_string(), Payload::SyncData(data))).await.map_err(|e| e.to_string())
}

// --- New File System Commands ---

#[command]
pub fn read_directory(path: String) -> Result<Vec<FileEntry>, String> {
    let paths = fs::read_dir(path).map_err(|e| e.to_string())?;
    let mut entries = Vec::new();
    
    for path in paths {
        let path = path.map_err(|e| e.to_string())?;
        let file_type = path.file_type().map_err(|e| e.to_string())?;
        let file_name = path.file_name().into_string().map_err(|_| "Invalid UTF-8".to_string())?;
        let file_path = path.path().to_string_lossy().to_string();
        
        // Skip hidden files/dotfiles for cleaner view
        if file_name.starts_with('.') { continue; }

        entries.push(FileEntry {
            name: file_name,
            path: file_path,
            is_dir: file_type.is_dir(),
        });
    }

    // Sort: Directories first, then files
    entries.sort_by(|a, b| {
        if a.is_dir == b.is_dir {
            a.name.cmp(&b.name)
        } else {
            if a.is_dir { std::cmp::Ordering::Less } else { std::cmp::Ordering::Greater }
        }
    });

    Ok(entries)
}

#[command]
pub fn read_file_content(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[command]
pub fn write_file_content(path: String, content: String) -> Result<(), String> {
    fs::write(path, content).map_err(|e| e.to_string())
}