use tauri::{command, State};
use std::sync::Arc;
use tokio::sync::Mutex;
use crate::protocol::{Payload, FileSyncEntry}; 
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

fn visit_dirs(dir: &Path, base: &Path, cb: &mut Vec<FileSyncEntry>) -> std::io::Result<()> {
    if dir.is_dir() {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            let file_name = path.file_name().unwrap_or_default().to_string_lossy();

            if file_name == ".git" || file_name == "node_modules" || file_name == "target" {
                continue;
            }

            if path.is_dir() {
                visit_dirs(&path, base, cb)?;
            } else {
                if let Ok(relative) = path.strip_prefix(base) {
                    let relative_str = relative.to_string_lossy().replace("\\", "/");
                    let content = fs::read(&path)?;
                    cb.push(FileSyncEntry {
                        path: relative_str,
                        content,
                    });
                }
            }
        }
    }
    Ok(())
}

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
    project_path: String, 
    sender: SenderState<'_>
) -> Result<(), String> {
    let mut files = Vec::new();
    let base_path = Path::new(&project_path);
    
    if base_path.exists() {
        visit_dirs(base_path, base_path, &mut files).map_err(|e| format!("Failed to pack project: {}", e))?;
    }

    let content = serde_json::to_vec(&files).map_err(|e| e.to_string())?;

    let tx = sender.lock().await;
    tx.send(("accept".to_string(), Payload::JoinAccept { peer_id, content })).await.map_err(|e| e.to_string())
}

#[command]
pub fn save_incoming_project(dest_path: String, data: Vec<u8>) -> Result<(), String> {
    let files: Vec<FileSyncEntry> = serde_json::from_slice(&data).map_err(|e| format!("Invalid project data: {}", e))?;
    let root = Path::new(&dest_path);

    fs::create_dir_all(root).map_err(|e| e.to_string())?;

    for file in files {
        let file_path = root.join(file.path);
        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(file_path, file.content).map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

#[command]
pub async fn broadcast_update(
    path: String,
    data: Vec<u8>, 
    sender: SenderState<'_>
) -> Result<(), String> {
    let tx = sender.lock().await;
    tx.send(("sync".to_string(), Payload::SyncData { path, data })).await.map_err(|e| e.to_string())
}

#[command]
pub async fn request_file_sync(
    path: String,
    sender: SenderState<'_>
) -> Result<(), String> {
    let tx = sender.lock().await;
    tx.send(("request_sync".to_string(), Payload::RequestSync { path })).await.map_err(|e| e.to_string())
}

// NEW: Command to send raw file content
#[command]
pub async fn broadcast_file_content(
    path: String,
    data: Vec<u8>,
    sender: SenderState<'_>
) -> Result<(), String> {
    let tx = sender.lock().await;
    tx.send(("file_content".to_string(), Payload::FileContent { path, data })).await.map_err(|e| e.to_string())
}

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
        if let Some(workdir) = repo.workdir() {
            if let Ok(relative_path) = path_obj.strip_prefix(workdir) {
                 let mut index = repo.index().map_err(|e| e.to_string())?;
                 index.add_path(relative_path).map_err(|_| "Failed to add path")?;
                 index.write().ok();
            }
        }
    }

    Ok(())
}

#[command]
pub fn get_remote_origin(path: String) -> Result<String, String> {
    let repo = Repository::open(&path).map_err(|e| e.to_string())?;
    let remote = repo.find_remote("origin").map_err(|_| "No remote 'origin' found".to_string())?;
    let url = remote.url().ok_or("Remote 'origin' has no URL")?;
    Ok(url.to_string())
}

#[command]
pub fn set_remote_origin(path: String, url: String) -> Result<String, String> {
    let repo = Repository::open(&path).map_err(|e| e.to_string())?;
    if repo.find_remote("origin").is_ok() {
        repo.remote_set_url("origin", &url).map_err(|e| e.to_string())?;
    } else {
        repo.remote("origin", &url).map_err(|e| e.to_string())?;
    }
    Ok(format!("Remote 'origin' set to {}", url))
}

#[command]
pub fn push_changes(path: String, ssh_key_path: String) -> Result<String, String> {
    let mut cmd = std::process::Command::new("git");
    cmd.current_dir(&path);
    cmd.arg("push");
    
    if !ssh_key_path.trim().is_empty() {
        #[cfg(target_os = "windows")]
        let ssh_cmd = format!("ssh -i \"{}\"", ssh_key_path.replace("\\", "\\\\"));
        #[cfg(not(target_os = "windows"))]
        let ssh_cmd = format!("ssh -i \"{}\"", ssh_key_path);
        cmd.env("GIT_SSH_COMMAND", ssh_cmd);
    }

    let output = cmd.output().map_err(|e| format!("Git command failed: {}", e))?;

    if output.status.success() {
        Ok("Push successful".to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}