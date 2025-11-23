// src-frontend/App.tsx
import { useState, useEffect, useRef, useCallback } from "react";
import { EditorContent } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus" 
import { useCollaborativeEditor } from "./hooks/useCollaborativeEditor";
import { useP2P } from "./hooks/useP2P";
import { PeerList } from "./components/PeerList";
import { IncomingRequest } from "./components/IncomingRequest";
import { FileExplorer } from "./components/FileExplorer";
import { MenuBar } from "./components/MenuBar";
import { Settings } from "./components/Settings";
import { WarningModal } from "./components/WarningModal";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { SlashMenu } from "./components/SlashMenu"; 
import "./App.css";

const META_FILE = ".collab_meta.json";

const getRelativePath = (root: string, file: string | null) => {
  if (!root || !file) return null;
  if (file.startsWith(root)) {
    let rel = file.substring(root.length);
    if (rel.startsWith("/") || rel.startsWith("\\")) rel = rel.substring(1);
    return rel;
  }
  return file; 
};

function App() {
  const [rootPath, setRootPath] = useState<string>("");
  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null);
  const [fileSystemRefresh, setFileSystemRefresh] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [sshKeyPath, setSshKeyPath] = useState(localStorage.getItem("sshKeyPath") || "");
  const [detectedRemote, setDetectedRemote] = useState("");
  const [warningMsg, setWarningMsg] = useState<string | null>(null);
  const [pendingQuit, setPendingQuit] = useState(false);
  const [isPushing, setIsPushing] = useState(false); 
  const [isSyncing, setIsSyncing] = useState(false);
  const syncReceivedRef = useRef(false); 

  const relativeFilePath = getRelativePath(rootPath, currentFilePath);
  const { editor, ydoc } = useCollaborativeEditor(currentFilePath, relativeFilePath);
  
  // REFS
  const rootPathRef = useRef(rootPath);
  const sshKeyPathRef = useRef(sshKeyPath);
  const isAutoJoining = useRef(false); // NEW: Track if we are auto-joining from meta file

  useEffect(() => {
    rootPathRef.current = rootPath;
  }, [rootPath]);

  useEffect(() => {
    sshKeyPathRef.current = sshKeyPath;
    localStorage.setItem("sshKeyPath", sshKeyPath);
  }, [sshKeyPath]);

  useEffect(() => {
    syncReceivedRef.current = false;
  }, [currentFilePath]);

  const getFileContent = useCallback(async (relativePath: string) => {
     if (!rootPath) throw new Error("No root path open");
     const sep = rootPath.includes("\\") ? "\\" : "/";
     const absPath = `${rootPath}${sep}${relativePath}`;
     return await invoke<string>("read_file_content", { path: absPath });
  }, [rootPath]);

  const onFileContentReceived = useCallback((data: number[]) => {
      if (!editor) return;
      try {
          const content = new TextDecoder().decode(new Uint8Array(data));
          try {
            const jsonContent = JSON.parse(content);
            if (jsonContent.type === 'doc' && Array.isArray(jsonContent.content)) {
              editor.commands.setContent(jsonContent);
            } else {
              editor.commands.setContent(content, { contentType: 'markdown' });
            }
          } catch (e) {
            editor.commands.setContent(content, { contentType: 'markdown' });
          }
          setIsSyncing(false);
          syncReceivedRef.current = true; 
      } catch (e) {
          console.error("Failed to set content", e);
      }
  }, [editor]);

  const onSyncReceived = useCallback(() => {
      setIsSyncing(false);
      syncReceivedRef.current = true;
  }, []);

  const handleProjectReceived = useCallback(async (data: number[]) => {
    let destPath: string | null = null;
    let silent = false;

    // FIX: If auto-joining (via meta file), use current root directly without prompt
    if (isAutoJoining.current && rootPathRef.current) {
        destPath = rootPathRef.current;
        silent = true; 
        isAutoJoining.current = false; // Reset flag
    } else {
        destPath = prompt("You joined a session! Enter absolute path to clone the project folder:");
    }

    if (destPath) {
      try {
        await invoke("save_incoming_project", { destPath, data });
        setRootPath(destPath);
        setFileSystemRefresh(prev => prev + 1);
        setDetectedRemote("");
        if (!silent) alert(`Project cloned to ${destPath}`);
      } catch (e) {
        setWarningMsg("Failed to save incoming project: " + e);
      }
    } else {
      setWarningMsg("Sync cancelled: No destination folder selected.");
    }
  }, []);

  const { 
    peers, 
    myPeerId,
    incomingRequest, 
    isHost, 
    isJoining, // [!code ++]
    status,
    setStatus,
    sendJoinRequest, 
    acceptRequest, 
    rejectRequest,
    requestSync
  } = useP2P(
      ydoc, 
      relativeFilePath, 
      handleProjectReceived,
      getFileContent, 
      onFileContentReceived,
      onSyncReceived 
  );

  // [!code ++] Track isHost in ref to access it in cleanup (onCloseRequested)
  const isHostRef = useRef(isHost);
  useEffect(() => {
    isHostRef.current = isHost;
  }, [isHost]);

  useEffect(() => {
    if (editor) {
      editor.setEditable(!isJoining);
    }
  }, [editor, isJoining]);

  // --- IMPROVED HOST NEGOTIATION LOGIC ---

  const negotiateHost = async (retryCount = 0) => {
    if (!rootPath || !myPeerId) return;
    
    setStatus(retryCount > 0 ? `Negotiating (Attempt ${retryCount + 1})...` : "Negotiating host...");
    
    const sep = rootPath.includes("\\") ? "\\" : "/";
    const metaPath = `${rootPath}${sep}${META_FILE}`;
    const ssh = sshKeyPathRef.current || "";

    try {
        // 1. Try to Pull (Ignore errors: it might be a new local folder)
        try {
            await invoke("git_pull", { path: rootPath, sshKeyPath: ssh });
        } catch (e) {
            console.log("Git pull skipped/failed (expected if new repo):", e);
        }
        
        // 2. Read Meta File
        let metaHost = "";
        try {
            const content = await invoke<string>("read_file_content", { path: metaPath });
            const json = JSON.parse(content);
            metaHost = json.hostId;
        } catch (e) {
            console.log("Meta file missing or invalid.");
        }

        // 3. Logic: Check if Host is Online
        if (metaHost && metaHost !== myPeerId) {
            const isOnline = peers.includes(metaHost);
            if (isOnline) {
                setStatus(`Found host ${metaHost.slice(0,8)}. Joining...`);
                isAutoJoining.current = true; // NEW: Set flag to suppress clone prompt
                sendJoinRequest(metaHost);
                return; // Logic ends here: we are a guest
            } else {
                setStatus(`Host ${metaHost.slice(0,8)} offline. Claiming host role...`);
            }
        }

        // 4. Become Host (If no meta, or host offline, or I am host)
        if (metaHost === myPeerId) {
            setStatus("I am the host (verified).");
            return; 
        }

        // Claim Host Role: Write ID to file
        await invoke("write_file_content", { 
            path: metaPath, 
            content: JSON.stringify({ hostId: myPeerId }, null, 2) 
        });

        // 5. Commit and Push [!code ++] Immediate push verified
        try {
            await invoke("push_changes", { path: rootPath, sshKeyPath: ssh });
            setStatus("Host claimed and synced.");
        } catch (e) {
            console.error("Push failed:", e);
            // RECURSIVE RETRY LOGIC
            if (retryCount < 2) {
                setStatus(`Push failed. Retrying... (${retryCount + 1}/2)`);
                setTimeout(() => negotiateHost(retryCount + 1), 2000);
            } else {
                setWarningMsg("Could not sync host status to remote.\n\nRunning in offline/local host mode.");
                setStatus("Host (Offline/Local)");
            }
        }

    } catch (e) {
        console.error("Negotiation fatal error:", e);
    }
  };

  // Trigger negotiation on Open or Peer ID ready
  useEffect(() => {
    if (rootPath && myPeerId) {
       negotiateHost();
    }
  }, [rootPath, myPeerId]); 

  // Trigger negotiation if I suddenly become host (e.g. previous host disconnects)
  const prevIsHost = useRef(isHost);
  useEffect(() => {
    if (!prevIsHost.current && isHost && rootPath) {
        negotiateHost();
    }
    prevIsHost.current = isHost;
  }, [isHost, rootPath]);


  // --- EXISTING FUNCTIONALITY ---

  useEffect(() => {
    if (currentFilePath && editor) {
      const loadFromDisk = () => {
          invoke<string>("read_file_content", { path: currentFilePath })
            .then((content) => {
              try {
                const jsonContent = JSON.parse(content);
                if (jsonContent.type === 'doc' && Array.isArray(jsonContent.content)) {
                  editor.commands.setContent(jsonContent);
                } else {
                  editor.commands.setContent(content, { contentType: 'markdown' });
                }
              } catch (e) {
                editor.commands.setContent(content, { contentType: 'markdown' });
              }
              setIsSyncing(false); // Ensure overlay is removed
            })
            .catch((e) => {
                setWarningMsg("Error opening file: " + e);
                setIsSyncing(false);
            });
      };

      if (isHost) {
          if (peers.length > 0 && relativeFilePath) {
              // Host attempts to sync from potential guests first
              setIsSyncing(true);
              requestSync(relativeFilePath);

              const timer = setTimeout(() => {
                   // Only load from disk if we haven't received a sync from a guest
                   if (!syncReceivedRef.current) {
                       // Check if empty is optional, but safer to just load if no sync arrived
                       loadFromDisk();
                   } else {
                       // Sync received, ensure overlay is off
                       setIsSyncing(false);
                   }
              }, 500);
              return () => clearTimeout(timer);
          } else {
              loadFromDisk();
          }
      } else {
          if (peers.length > 0 && relativeFilePath) {
              setIsSyncing(true);
              requestSync(relativeFilePath);
          } else {
              loadFromDisk();
          }
      }
    }
  }, [currentFilePath, editor, peers.length, relativeFilePath, isHost, ydoc]);

  useEffect(() => {
    if (showSettings && rootPath) {
      invoke<string>("get_remote_origin", { path: rootPath })
        .then(setDetectedRemote)
        .catch(() => setDetectedRemote(""));
    }
  }, [showSettings, rootPath]);

  useEffect(() => {
    const win = getCurrentWindow();
    const unlisten = win.onCloseRequested(async (event) => {
      const currentRoot = rootPathRef.current;
      const currentSsh = sshKeyPathRef.current;

      if (currentRoot && !pendingQuit) {
        event.preventDefault(); 
        setIsPushing(true);
        try {
          // [!code ++] FIX: If we are host, clear the hostId in meta file before pushing
          if (isHostRef.current) {
             const sep = currentRoot.includes("\\") ? "\\" : "/";
             const metaPath = `${currentRoot}${sep}${META_FILE}`;
             try {
                await invoke("write_file_content", { 
                    path: metaPath, 
                    content: JSON.stringify({ hostId: "" }, null, 2) 
                });
             } catch (e) {
                console.error("Failed to clear host ID:", e);
             }
          }

          await invoke("push_changes", { path: currentRoot, sshKeyPath: currentSsh || "" });
          await win.destroy();
        } catch (e: any) {
          setIsPushing(false);
          setWarningMsg(`Failed to push changes before quitting:\n\n${e}\n\nQuit anyway?`);
          setPendingQuit(true);
        }
      } else if (pendingQuit) {
         event.preventDefault();
      }
    });
    return () => { unlisten.then(f => f()); };
  }, [pendingQuit]);

  const handleOpenFolder = async () => {
    if (rootPath) {
      try { await invoke("push_changes", { path: rootPath, sshKeyPath: sshKeyPath || "" }); } catch (e) { return; }
    }

    const path = prompt("Enter absolute folder path to open:");
    if (path) {
      setRootPath(path);
      setFileSystemRefresh(prev => prev + 1);
      setDetectedRemote("");
      try {
        await invoke<string>("init_git_repo", { path });
        const remote = await invoke<string>("get_remote_origin", { path });
        setDetectedRemote(remote);
      } catch (e) {
        console.log("Git Init/Check status:", e);
      }
    }
  };

  const handleQuit = async () => {
    const win = getCurrentWindow();
    await win.close();
  };

  const handleForceQuit = async () => {
    await getCurrentWindow().destroy();
  };

  const handleOpenFile = (path: string) => {
    setCurrentFilePath(path);
  };

  const handleNewFile = () => {
    setCurrentFilePath(null);
    editor?.commands.clearContent();
  };

  const handleSave = async () => {
    if (!currentFilePath) {
      handleSaveAs();
      return;
    }
    await saveToDisk(currentFilePath);
  };

  const handleSaveAs = async () => {
    const defaultName = currentFilePath || (rootPath ? `${rootPath}/untitled.json` : "untitled.json");
    const path = prompt("Enter full path to save file:", defaultName);
    if (path) {
      await saveToDisk(path);
      setCurrentFilePath(path);
    }
  };

  const saveToDisk = async (path: string) => {
    try {
      if (!editor) return;
      let content = "";
      if (path.endsWith(".json")) {
        content = JSON.stringify(editor.getJSON(), null, 2);
      } else {
         content = editor.getText(); 
      }
      await invoke("write_file_content", { path, content });
      setFileSystemRefresh(prev => prev + 1);
    } catch (e) {
      setWarningMsg("Error saving: " + e);
    }
  };

  return (
    <div className="app-layout">
      <MenuBar 
        onNew={handleNewFile}
        onOpenFolder={handleOpenFolder}
        onSave={handleSave}
        onSaveAs={handleSaveAs}
        onSettings={() => setShowSettings(true)}
        onQuit={handleQuit}
        currentFile={currentFilePath}
      />
      
      <Settings 
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        sshKeyPath={sshKeyPath}
        setSshKeyPath={setSshKeyPath}
        detectedRemote={detectedRemote}
      />

      <WarningModal 
        isOpen={!!warningMsg}
        message={warningMsg || ""}
        onClose={() => { setWarningMsg(null); setPendingQuit(false); }}
        onConfirm={pendingQuit ? handleForceQuit : undefined}
        confirmText="Quit Anyway"
      />

      <div className="main-workspace">
        {(isSyncing || isPushing) && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(30, 30, 46, 0.8)', color: '#cdd6f4', 
            zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column'
          }}>
            <div style={{ fontSize: '1.2rem', marginBottom: '10px' }}>
              {isPushing ? "Pushing changes to remote..." : "Syncing content..."}
            </div>
            {isPushing && <small>Please wait, do not close.</small>}
          </div>
        )}

        <aside className="sidebar">
           <FileExplorer 
             rootPath={rootPath} 
             onOpenFile={handleOpenFile} 
             refreshTrigger={fileSystemRefresh} 
           />
           
           <div className="p2p-panel">
              <h3>P2P Status: {isHost ? "Host" : "Guest"}</h3>
              <p className="status-text">{status}</p>
              <PeerList peers={peers} onJoin={sendJoinRequest} />
              {incomingRequest && (
                <IncomingRequest 
                  peerId={incomingRequest} 
                  onAccept={() => acceptRequest(rootPath)} 
                  onReject={rejectRequest} 
                />
              )}
           </div>
        </aside>

        <main className="editor-container">
          <div className="editor-scroll-area">
             {editor && <SlashMenu editor={editor} />}

            {editor && (
              <BubbleMenu className="bubble-menu" editor={editor}>
                <button onClick={() => editor.chain().focus().toggleBold().run()} className={editor.isActive('bold') ? 'is-active' : ''}>Bold</button>
                <button onClick={() => editor.chain().focus().toggleItalic().run()} className={editor.isActive('italic') ? 'is-active' : ''}>Italic</button>
                <button onClick={() => editor.chain().focus().toggleCode().run()} className={editor.isActive('code') ? 'is-active' : ''}>Code</button>
              </BubbleMenu>
            )}
            <EditorContent editor={editor} />
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;