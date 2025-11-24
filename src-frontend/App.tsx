import { useState, useEffect, useRef, useCallback } from "react";
import { EditorContent } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus" 
import { useCollaborativeEditor } from "./hooks/useCollaborativeEditor";
import { useP2P } from "./hooks/useP2P";
import { IncomingRequest } from "./components/IncomingRequest";
import { FileExplorer } from "./components/FileExplorer";
import { MenuBar } from "./components/MenuBar";
import { Settings } from "./components/Settings";
import { WarningModal } from "./components/WarningModal";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { SlashMenu } from "./components/SlashMenu"; 
import * as Y from "yjs";
import { documentRegistry } from "./mod-engine/DocumentRegistry";
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
  const deadHostIdRef = useRef<string | null>(null);

  const relativeFilePath = getRelativePath(rootPath, currentFilePath);
  const [currentDoc, setCurrentDoc] = useState<Y.Doc | null>(null);
  const { editor } = useCollaborativeEditor(currentDoc);
  
  const rootPathRef = useRef(rootPath);
  const sshKeyPathRef = useRef(sshKeyPath);
  const isAutoJoining = useRef(false); 
  const currentFilePathRef = useRef(currentFilePath);

  useEffect(() => {
    rootPathRef.current = rootPath;
    // FIX: Update the registry with the new root path
    documentRegistry.setRootPath(rootPath);
  }, [rootPath]);

  useEffect(() => {
    sshKeyPathRef.current = sshKeyPath;
    localStorage.setItem("sshKeyPath", sshKeyPath);
  }, [sshKeyPath]);
  
  useEffect(() => {
    currentFilePathRef.current = currentFilePath;
  }, [currentFilePath]);

  const handleProjectReceived = useCallback(async (data: number[]) => {
    let destPath: string | null = null;
    let silent = false;

    if (isAutoJoining.current && rootPathRef.current) {
        destPath = rootPathRef.current;
        silent = true; 
        isAutoJoining.current = false; 
    } else {
        destPath = prompt("You joined a session! Enter absolute path to clone the project folder:");
    }

    if (destPath) {
      try {
        await invoke("save_incoming_project", { destPath, data });
        setRootPath(destPath);
        setFileSystemRefresh(prev => prev + 1);
        setDetectedRemote("");

        const activeFile = currentFilePathRef.current;
        if (activeFile) {
           setCurrentFilePath(null);
           setTimeout(() => setCurrentFilePath(activeFile), 50);
        }

        if (!silent) alert(`Project cloned to ${destPath}`);
      } catch (e) {
        setWarningMsg("Failed to save incoming project: " + e);
      }
    } else {
      setWarningMsg("Sync cancelled: No destination folder selected.");
    }
  }, []);

  const handleHostDisconnect = useCallback((hostId: string) => {
      deadHostIdRef.current = hostId;
  }, []);

  const handleFileSync = useCallback((syncedPath: string) => {
      const currentRel = getRelativePath(rootPathRef.current, currentFilePathRef.current);
      if (currentRel === syncedPath) {
          setIsSyncing(false);
      }
  }, []);

  const { 
    myPeerId,
    incomingRequest, 
    isHost, 
    isJoining,
    status,
    setStatus,
    sendJoinRequest, 
    acceptRequest, 
    rejectRequest,
    requestSync,
    myAddresses 
  } = useP2P(
      handleProjectReceived,
      handleHostDisconnect,
      handleFileSync
  );

  useEffect(() => {
    if (relativeFilePath) {
      const doc = documentRegistry.getOrCreateDoc(relativeFilePath);
      setCurrentDoc(doc);
      if (!isHost && requestSync) {
        requestSync(relativeFilePath);
        setIsSyncing(true);
      } else {
        // If host, we might want to reset the syncing status
        setIsSyncing(false);
      }
    } else {
      setCurrentDoc(null);
    }
  }, [relativeFilePath, isHost, requestSync]);

  const isHostRef = useRef(isHost);
  useEffect(() => {
    isHostRef.current = isHost;
  }, [isHost]);

  useEffect(() => {
    if (editor) {
      editor.setEditable(!isJoining);
    }
  }, [editor, isJoining]);





  const negotiateHost = async (retryCount = 0) => {
    if (!rootPath || !myPeerId) return;
    
    setStatus(retryCount > 0 ? `Negotiating (Attempt ${retryCount + 1})...` : "Negotiating host...");
    
    const sep = rootPath.includes("\\") ? "\\": "/";
    const metaPath = `${rootPath}${sep}${META_FILE}`;
    const ssh = sshKeyPathRef.current || "";

    try {
        try {
            await invoke("git_pull", { path: rootPath, sshKeyPath: ssh });
        } catch (e) {
            console.log("Git pull skipped/failed (expected if new repo):", e);
        }
        
        let metaHost = "";
        let metaAddrs: string[] = [];
        try {
            const contentBytes = await invoke<number[]>("read_file_content", { path: metaPath });
            const content = new TextDecoder().decode(new Uint8Array(contentBytes));
            const json = JSON.parse(content);
            metaHost = json.hostId;
            metaAddrs = json.hostAddrs || [];
        } catch (e) {
            console.log("Meta file missing or invalid.");
        }

        if (metaHost && metaHost !== myPeerId) {
            // FIX: If the meta points to the dead host, ignore it and claim host.
            if (deadHostIdRef.current && metaHost === deadHostIdRef.current) {
                console.log("Ignoring disconnected host ID in meta file.");
            } else {
                if (!isHost) return;

                setStatus(`Found host ${metaHost.slice(0,8)}. Joining...`);
                isAutoJoining.current = true; 
                const targetAddrs = metaAddrs || [];
                sendJoinRequest(metaHost, targetAddrs);
                return; 
            }
        }

        if (metaHost === myPeerId) {
             const currentSavedAddrs = metaAddrs || [];
             const sortedSaved = [...currentSavedAddrs].sort();
             const sortedCurrent = [...myAddresses].sort();
             
             if (JSON.stringify(sortedSaved) === JSON.stringify(sortedCurrent)) {
                 setStatus("I am the host (verified).");
                 return; 
             }
             setStatus("Updating host addresses...");
        }

        const content = new TextEncoder().encode(JSON.stringify({ hostId: myPeerId, hostAddrs: myAddresses }, null, 2));
        await invoke("write_file_content", { 
            path: metaPath, 
            content: Array.from(content)
        });

        try {
            await invoke("push_changes", { path: rootPath, sshKeyPath: ssh });
            setStatus("Host claimed and synced.");
            // Clear dead host ref since we successfully claimed it
            deadHostIdRef.current = null;
        } catch (e) {
            console.error("Push failed:", e);
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

  useEffect(() => {
    if (rootPath && myPeerId) {
       negotiateHost();
    }
  }, [rootPath, myPeerId, myAddresses]); 

  const prevIsHost = useRef(isHost);
  useEffect(() => {
    if (!prevIsHost.current && isHost && rootPath) {
        negotiateHost();
    }
    prevIsHost.current = isHost;
  }, [isHost, rootPath]);




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
          if (isHostRef.current) {
             const sep = currentRoot.includes("\\") ? "\\": "/";
             const metaPath = `${currentRoot}${sep}${META_FILE}`;
             const content = new TextEncoder().encode(JSON.stringify({ hostId: "" }, null, 2));
             try {
                await invoke("write_file_content", { 
                    path: metaPath, 
                    content: Array.from(content)
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
      try { 
        await invoke("push_changes", { path: rootPath, sshKeyPath: sshKeyPath || "" }); 
      } catch (e) { 
        console.error("Failed to push changes for previous folder, but proceeding anyway:", e);
      }
    }

    setTimeout(() => {
      try {
        const path = prompt("Enter absolute folder path to open:");
        if (path) {
          setRootPath(path);
          setFileSystemRefresh(prev => prev + 1);
          setDetectedRemote("");
          try {
            invoke<string>("init_git_repo", { path });
            invoke<string>("get_remote_origin", { path }).then(setDetectedRemote);
          } catch (e) {
            console.log("Git Init/Check status:", e);
          }
        }
      } catch (e) {
        setWarningMsg("Could not open folder prompt: " + e);
      }
    }, 50);
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

  return (
    <div className="app-layout">
      <MenuBar 
        onNew={handleNewFile}
        onOpenFolder={handleOpenFolder}
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