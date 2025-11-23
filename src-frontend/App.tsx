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
  
  const rootPathRef = useRef(rootPath);
  const sshKeyPathRef = useRef(sshKeyPath);
  const isAutoJoining = useRef(false); 
  const currentFilePathRef = useRef(currentFilePath);

  useEffect(() => {
    rootPathRef.current = rootPath;
  }, [rootPath]);

  useEffect(() => {
    sshKeyPathRef.current = sshKeyPath;
    localStorage.setItem("sshKeyPath", sshKeyPath);
  }, [sshKeyPath]);
  
  useEffect(() => {
    currentFilePathRef.current = currentFilePath;
  }, [currentFilePath]);

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
    myAddresses // NEW: Use myAddresses
  } = useP2P(
      ydoc, 
      relativeFilePath, 
      handleProjectReceived,
      getFileContent, 
      onFileContentReceived,
      onSyncReceived 
  );

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
    
    const sep = rootPath.includes("\\") ? "\\" : "/";
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
            const content = await invoke<string>("read_file_content", { path: metaPath });
            const json = JSON.parse(content);
            metaHost = json.hostId;
            metaAddrs = json.hostAddrs || [];
        } catch (e) {
            console.log("Meta file missing or invalid.");
        }

        if (metaHost && metaHost !== myPeerId) {
            setStatus(`Found host ${metaHost.slice(0,8)}. Joining...`);
            isAutoJoining.current = true; 
            // NEW: Pick first available address to join
            const targetAddr = metaAddrs.length > 0 ? metaAddrs[0] : undefined;
            sendJoinRequest(metaHost, targetAddr);
            return; 
        }

        if (metaHost === myPeerId) {
             // NEW: Check if addresses match what we have, to update them if needed
             const currentSavedAddrs = metaAddrs || [];
             const sortedSaved = [...currentSavedAddrs].sort();
             const sortedCurrent = [...myAddresses].sort();
             
             if (JSON.stringify(sortedSaved) === JSON.stringify(sortedCurrent)) {
                 setStatus("I am the host (verified).");
                 return; 
             }
             setStatus("Updating host addresses...");
        }

        if (!isHostRef.current) return;

        // Claim Host Role: Write ID and Addresses
        await invoke("write_file_content", { 
            path: metaPath, 
            content: JSON.stringify({ hostId: myPeerId, hostAddrs: myAddresses }, null, 2) 
        });

        try {
            await invoke("push_changes", { path: rootPath, sshKeyPath: ssh });
            setStatus("Host claimed and synced.");
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

  // NEW: Re-negotiate when myAddresses changes to ensure IP is shared
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
              setIsSyncing(false); 
            })
            .catch((e) => {
                setWarningMsg("Error opening file: " + e);
                setIsSyncing(false);
            });
      };

      if (isHost) {
        loadFromDisk();
      } else {
          if (relativeFilePath) {
              setIsSyncing(true);
              requestSync(relativeFilePath);
          } else {
              loadFromDisk();
          }
      }
    }
  }, [currentFilePath, editor, relativeFilePath, isHost, ydoc]);

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