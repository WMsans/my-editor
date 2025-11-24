// src-frontend/App.tsx
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
  const suppressBroadcastRef = useRef(false);

  // Global Registry of Y.Docs
  const docRegistry = useRef<Map<string, Y.Doc>>(new Map());
  const [currentDoc, setCurrentDoc] = useState<Y.Doc | null>(null);

  const relativeFilePath = getRelativePath(rootPath, currentFilePath);
  
  const { editor } = useCollaborativeEditor(currentDoc, relativeFilePath, suppressBroadcastRef);
  
  const rootPathRef = useRef(rootPath);
  const sshKeyPathRef = useRef(sshKeyPath);
  const isAutoJoining = useRef(false); 
  const currentFilePathRef = useRef(currentFilePath);

  // Refs for debouncing/locking negotiation
  const negotiatingLock = useRef(false);
  const addressUpdateTimer = useRef<number | null>(null);

  useEffect(() => { rootPathRef.current = rootPath; }, [rootPath]);
  useEffect(() => { sshKeyPathRef.current = sshKeyPath; localStorage.setItem("sshKeyPath", sshKeyPath); }, [sshKeyPath]);
  useEffect(() => { currentFilePathRef.current = currentFilePath; }, [currentFilePath]);

  // Helper to get or create a Doc for ANY path
  const getDoc = useCallback(async (relativePath: string): Promise<Y.Doc> => {
      if (docRegistry.current.has(relativePath)) {
          return docRegistry.current.get(relativePath)!;
      }

      const newDoc = new Y.Doc();
      
      if (rootPathRef.current) {
         try {
             const sep = rootPathRef.current.includes("\\") ? "\\" : "/";
             const absPath = `${rootPathRef.current}${sep}${relativePath}`;
             const content = await invoke<string>("read_file_content", { path: absPath });
             newDoc.getText('default').insert(0, content);
         } catch (e) {
             // File might be new or empty, ignore
         }
      }

      docRegistry.current.set(relativePath, newDoc);
      return newDoc;
  }, []);

  const onSyncReceived = useCallback(() => {
      setIsSyncing(false);
  }, []);

  const handleProjectReceived = useCallback(async (data: number[]) => {
    let destPath: string | null = null;
    if (isAutoJoining.current && rootPathRef.current) {
        destPath = rootPathRef.current;
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
        docRegistry.current.clear(); 
      } catch (e) {
        setWarningMsg("Failed to save incoming project: " + e);
      }
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
      getDoc, 
      relativeFilePath, 
      handleProjectReceived,
      onSyncReceived,
      (hostId) => { deadHostIdRef.current = hostId; }
  );

  // Switch Current Doc when File Changes
  useEffect(() => {
    if (!relativeFilePath) {
        setCurrentDoc(null);
        return;
    }

    setIsSyncing(true);
    getDoc(relativeFilePath)
        .then(doc => {
            setCurrentDoc(doc);
            setIsSyncing(false);
            if (!isHost) {
                requestSync(relativeFilePath);
            }
        })
        .catch(e => {
            console.error("Error loading doc:", e);
            setIsSyncing(false);
        });
  }, [relativeFilePath, isHost, getDoc]);

  // --- Negotiation Logic ---

  const handleForceHost = async () => {
    if (!rootPath || !myPeerId) return;
    setStatus("Forcing host claim...");
    isAutoJoining.current = false;
    
    const sep = rootPath.includes("\\") ? "\\" : "/";
    const metaPath = `${rootPath}${sep}${META_FILE}`;
    
    try {
        await invoke("write_file_content", { 
            path: metaPath, 
            content: JSON.stringify({ hostId: myPeerId, hostAddrs: myAddresses }, null, 2) 
        });
        await invoke("push_changes", { path: rootPath, sshKeyPath: sshKeyPath });
        setStatus("Host claimed (Forced).");
        window.location.reload(); 
    } catch (e) {
        setWarningMsg("Failed to force host: " + e);
    }
  };

  const isHostRef = useRef(isHost);
  useEffect(() => { isHostRef.current = isHost; }, [isHost]);

  useEffect(() => {
    if (editor) editor.setEditable(!isJoining);
  }, [editor, isJoining]);

  const negotiateHost = async (retryCount = 0) => {
    if (negotiatingLock.current && retryCount === 0) return;
    negotiatingLock.current = true;

    if (!rootPath || !myPeerId) {
        negotiatingLock.current = false;
        return;
    }
    
    setStatus(retryCount > 0 ? `Negotiating (Attempt ${retryCount + 1})...` : "Negotiating host...");
    
    const sep = rootPath.includes("\\") ? "\\" : "/";
    const metaPath = `${rootPath}${sep}${META_FILE}`;
    const ssh = sshKeyPathRef.current || "";

    try {
        // Try to pull first to get latest meta
        try {
            await invoke("git_pull", { path: rootPath, sshKeyPath: ssh });
        } catch (e) {
            console.log("Git pull skipped/failed:", e);
        }
        
        let metaHost = "";
        let metaAddrs: string[] = [];
        try {
            const content = await invoke<string>("read_file_content", { path: metaPath });
            const json = JSON.parse(content);
            metaHost = json.hostId;
            metaAddrs = json.hostAddrs || [];
        } catch (e) {
            console.log("Meta file missing/invalid.");
        }

        // 1. If someone else is host, join them
        if (metaHost && metaHost !== myPeerId) {
            if (deadHostIdRef.current && metaHost === deadHostIdRef.current) {
                console.log("Ignoring disconnected host ID");
            } else {
                if (!isHostRef.current) {
                    negotiatingLock.current = false;
                    return;
                }

                setStatus(`Found host ${metaHost.slice(0,8)}. Joining...`);
                isAutoJoining.current = true; 
                sendJoinRequest(metaHost, metaAddrs);
                negotiatingLock.current = false;
                return; 
            }
        }

        // 2. If I am host, check if update is needed
        if (metaHost === myPeerId) {
             const sortedSaved = [...metaAddrs].sort();
             const sortedCurrent = [...myAddresses].sort();
             
             if (JSON.stringify(sortedSaved) === JSON.stringify(sortedCurrent)) {
                 setStatus("I am the host (verified).");
                 negotiatingLock.current = false;
                 return; 
             }
             setStatus("Updating host addresses...");
        }

        // 3. Claim Host / Update Addresses
        await invoke("write_file_content", { 
            path: metaPath, 
            content: JSON.stringify({ hostId: myPeerId, hostAddrs: myAddresses }, null, 2) 
        });

        try {
            await invoke("push_changes", { path: rootPath, sshKeyPath: ssh });
            setStatus("Host claimed and synced.");
            deadHostIdRef.current = null;
        } catch (e) {
            console.error("Push failed:", e);
            if (retryCount < 2) {
                // Wait before retry
                setTimeout(() => negotiateHost(retryCount + 1), 2000);
                return; // Keep lock true
            } else {
                setWarningMsg("Could not sync host status to remote.\n\nRunning in offline/local host mode.");
                setStatus("Host (Offline/Local)");
            }
        }

    } catch (e) {
        console.error("Negotiation fatal error:", e);
    }
    
    negotiatingLock.current = false;
  };

  // --- Effect: Debounce Address Updates ---
  useEffect(() => {
    if (rootPath && myPeerId) {
        // Clear existing timer
        if (addressUpdateTimer.current) {
            window.clearTimeout(addressUpdateTimer.current);
        }

        // If this is the FIRST run (initializing), run almost immediately
        if (status === "Initializing...") {
             negotiateHost();
        } else {
            // Otherwise wait for addresses to settle (2 seconds)
            addressUpdateTimer.current = window.setTimeout(() => {
                negotiateHost();
            }, 2000);
        }
    }
    return () => {
        if (addressUpdateTimer.current) window.clearTimeout(addressUpdateTimer.current);
    }
  }, [rootPath, myPeerId, myAddresses]); 

  // --- Effect: Host Status Changed ---
  const prevIsHost = useRef(isHost);
  useEffect(() => {
    if (!prevIsHost.current && isHost && rootPath) {
        negotiateHost();
    }
    prevIsHost.current = isHost;
  }, [isHost, rootPath]);


  // --- File/Menu Handlers ---

  const handleOpenFolder = async () => {
    if (rootPath) {
      try { await invoke("push_changes", { path: rootPath, sshKeyPath: sshKeyPath || "" }); } catch (e) { return; }
    }
    const path = prompt("Enter absolute folder path to open:");
    if (path) {
      setRootPath(path);
      setFileSystemRefresh(prev => prev + 1);
      setDetectedRemote("");
      docRegistry.current.clear();
      try {
        await invoke<string>("init_git_repo", { path });
        const remote = await invoke<string>("get_remote_origin", { path });
        setDetectedRemote(remote);
      } catch (e) {}
    }
  };
  
  const handleQuit = async () => { await getCurrentWindow().close(); };
  const handleForceQuit = async () => { await getCurrentWindow().destroy(); };
  const handleOpenFile = (path: string) => { setCurrentFilePath(path); };
  const handleNewFile = () => { setCurrentFilePath(null); editor?.commands.clearContent(); };

  const handleSave = async () => {
    if (!currentFilePath) { handleSaveAs(); return; }
    await saveToDisk(currentFilePath);
  };

  const handleSaveAs = async () => {
    const defaultName = currentFilePath || (rootPath ? `${rootPath}/untitled.json` : "untitled.json");
    const path = prompt("Enter full path to save file:", defaultName);
    if (path) { await saveToDisk(path); setCurrentFilePath(path); }
  };

  const saveToDisk = async (path: string) => {
    try {
      if (!editor) return;
      let content = "";
      if (path.endsWith(".json")) content = JSON.stringify(editor.getJSON(), null, 2);
      else content = editor.getText(); 
      await invoke("write_file_content", { path, content });
      setFileSystemRefresh(prev => prev + 1);
    } catch (e) { setWarningMsg("Error saving: " + e); }
  };

  // Close Handler
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
             const sep = currentRoot.includes("\\") ? "\\" : "/";
             const metaPath = `${currentRoot}${sep}${META_FILE}`;
             try { await invoke("write_file_content", { path: metaPath, content: JSON.stringify({ hostId: "" }, null, 2) }); } catch (e) {}
          }
          await invoke("push_changes", { path: currentRoot, sshKeyPath: currentSsh || "" });
          await win.destroy();
        } catch (e: any) {
          setIsPushing(false);
          setWarningMsg(`Failed to push changes before quitting:\n\n${e}\n\nQuit anyway?`);
          setPendingQuit(true);
        }
      } else if (pendingQuit) event.preventDefault();
    });
    return () => { unlisten.then(f => f()); };
  }, [pendingQuit]);


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
              
              {!isHost && status.includes("Joining") && (
                 <button 
                   onClick={handleForceHost} 
                   style={{ marginTop: '10px', width: '100%', background: '#fab387', color: '#1e1e2e', border: 'none', padding: '5px', cursor: 'pointer' }}
                 >
                   Stop Joining & Become Host
                 </button>
              )}

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