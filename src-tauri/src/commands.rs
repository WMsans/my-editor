use tauri::{command, State};
use std::sync::Arc;
use tokio::sync::Mutex;
use crate::protocol::Payload;
use crate::state::PeerState;
use std::fs;
use std::path::Path;
use serde::Serialize;
use git2::{Repository, Signature, IndexAddOption, Cred, RemoteCallbacks, PushOptions};

type SenderState<'a> = State<'a, Arc<Mutex<tokio::sync::mpsc::Sender<(String, Payload)>>>>;

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

// --- File System & Git Commands ---

#[command]
pub fn read_directory(path: String) -> Result<Vec<FileEntry>, String> {
    let paths = fs::read_dir(path).map_err(|e| e.to_string())?;
    let mut entries = Vec::new();
    
    for path in paths {
        let path = path.map_err(|e| e.to_string())?;
        let file_type = path.file_type().map_err(|e| e.to_string())?;
        let file_name = path.file_name().into_string().map_err(|_| "Invalid UTF-8".to_string())?;
        let file_path = path.path().to_string_lossy().to_string();
        
        if file_name.starts_with('.') { continue; }

        entries.push(FileEntry {
            name: file_name,
            path: file_path,
            is_dir: file_type.is_dir(),
        });
    }

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
pub fn init_git_repo(path: String) -> Result<String, String> {
    match Repository::init(&path) {
        Ok(_) => Ok(format!("Initialized Git repository in {}", path)),
        Err(e) => Err(format!("Failed to init repo: {}", e)),
    }
}

#[command]
pub fn write_file_content(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| e.to_string())?;

    if let Ok(repo) = Repository::discover(&path) {
        let path_obj = Path::new(&path);
        let workdir = repo.workdir().ok_or("No working directory found")?;
        let relative_path = path_obj.strip_prefix(workdir).map_err(|e| e.to_string())?;

        let mut index = repo.index().map_err(|e| e.to_string())?;
        index.add_path(relative_path).map_err(|e| format!("Git add failed: {}", e))?;
        index.write().map_err(|e| e.to_string())?;

        let oid = index.write_tree().map_err(|e| e.to_string())?;
        let tree = repo.find_tree(oid).map_err(|e| e.to_string())?;
        
        let signature = Signature::now("Collaborative Editor", "user@local")
            .map_err(|e| e.to_string())?;

        let parent_commit = match repo.head() {
            Ok(head) => {
                let target = head.target().ok_or("HEAD has no target")?;
                Some(repo.find_commit(target).map_err(|e| e.to_string())?)
            },
            Err(_) => None,
        };

        let parents = match parent_commit {
            Some(ref c) => vec![c],
            None => vec![],
        };

        repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            &format!("Auto-save: {}", relative_path.display()),
            &tree,
            &parents,
        ).map_err(|e| format!("Git commit failed: {}", e))?;
    }

    Ok(())
}

#[command]
pub fn set_remote_origin(path: String, url: String) -> Result<String, String> {
    let repo = Repository::open(&path).map_err(|e| e.to_string())?;
    
    // Remove existing 'origin' if it exists to replace it, or just set url
    if repo.find_remote("origin").is_ok() {
        repo.remote_set_url("origin", &url).map_err(|e| e.to_string())?;
    } else {
        repo.remote("origin", &url).map_err(|e| e.to_string())?;
    }
    Ok(format!("Remote 'origin' set to {}", url))
}

#[command]
pub fn push_changes(path: String, ssh_key_path: String) -> Result<String, String> {
    let repo = Repository::open(&path).map_err(|e| e.to_string())?;
    let mut remote = repo.find_remote("origin").map_err(|e| "No remote 'origin' found".to_string())?;

    let mut callbacks = RemoteCallbacks::new();
    callbacks.credentials(move |_url, username_from_url, _allowed_types| {
        Cred::ssh_key(
            username_from_url.unwrap_or("git"),
            None,
            std::path::Path::new(&ssh_key_path),
            None,
        )
    });

    let mut push_options = PushOptions::new();
    push_options.remote_callbacks(callbacks);

    // Determine current branch to push
    let head = repo.head().map_err(|e| e.to_string())?;
    let head_name = head.name().ok_or("HEAD is detached or invalid")?;
    
    // Push HEAD to the same branch on remote
    // Using refspec: e.g. "refs/heads/main"
    remote.push(&[head_name], Some(&mut push_options)).map_err(|e| e.to_string())?;

    Ok("Push successful".to_string())
}