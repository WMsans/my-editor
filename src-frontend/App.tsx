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

// Helper to get relative path for P2P sync ID
const getRelativePath = (root: string, file: string | null) => {
  if (!root || !file) return null;
  if (file.startsWith(root)) {
    let rel = file.substring(root.length);
    // Remove leading slashes/backslashes
    if (rel.startsWith("/") || rel.startsWith("\\")) rel = rel.substring(1);
    return rel;
  }
  return file; // Fallback
};

function App() {
  // State for folder management
  const [rootPath, setRootPath] = useState<string>("");
  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null);
  const [fileSystemRefresh, setFileSystemRefresh] = useState(0);
  
  // Settings State
  const [showSettings, setShowSettings] = useState(false);
  const [sshKeyPath, setSshKeyPath] = useState(localStorage.getItem("sshKeyPath") || "");
  const [detectedRemote, setDetectedRemote] = useState("");
  
  // Warning & Status State
  const [warningMsg, setWarningMsg] = useState<string | null>(null);
  const [pendingQuit, setPendingQuit] = useState(false);
  const [isPushing, setIsPushing] = useState(false); // New UI state
  
  // Sync State
  const [isSyncing, setIsSyncing] = useState(false);
  const syncReceivedRef = useRef(false); 

  // Calculate relative path for the current session ID
  const relativeFilePath = getRelativePath(rootPath, currentFilePath);

  // Pass the RELATIVE path to hooks so peers agree on ID
  const { editor, ydoc } = useCollaborativeEditor(currentFilePath, relativeFilePath);

  // Refs
  const rootPathRef = useRef(rootPath);
  const sshKeyPathRef = useRef(sshKeyPath);

  useEffect(() => {
    rootPathRef.current = rootPath;
  }, [rootPath]);

  useEffect(() => {
    sshKeyPathRef.current = sshKeyPath;
    localStorage.setItem("sshKeyPath", sshKeyPath);
  }, [sshKeyPath]);

  // Reset sync ref when file changes
  useEffect(() => {
    syncReceivedRef.current = false;
  }, [currentFilePath]);

  // Callback: Host reads a file from disk to serve to a guest
  const getFileContent = useCallback(async (relativePath: string) => {
     if (!rootPath) throw new Error("No root path open");
     const sep = rootPath.includes("\\") ? "\\" : "/";
     const absPath = `${rootPath}${sep}${relativePath}`;
     return await invoke<string>("read_file_content", { path: absPath });
  }, [rootPath]);

  // Callback: Guest receives raw file content from Host
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

  // Callback: Yjs Sync Received
  const onSyncReceived = useCallback(() => {
      setIsSyncing(false);
      syncReceivedRef.current = true;
  }, []);

  // Define onProjectReceived logic
  const handleProjectReceived = useCallback(async (data: number[]) => {
    const destPath = prompt("You joined a session! Enter absolute path to clone the project folder:");
    if (destPath) {
      try {
        await invoke("save_incoming_project", { destPath, data });
        setRootPath(destPath);
        setFileSystemRefresh(prev => prev + 1);
        setDetectedRemote("");
        alert(`Project cloned to ${destPath}`);
      } catch (e) {
        setWarningMsg("Failed to save incoming project: " + e);
      }
    } else {
      setWarningMsg("Sync cancelled: No destination folder selected.");
    }
  }, []);

  const { 
    peers, 
    incomingRequest, 
    isHost, 
    status, 
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

  // -- File Content Loading Logic --
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
            })
            .catch((e) => setWarningMsg("Error opening file: " + e));
      };

      if (isHost) {
          if (peers.length > 0 && relativeFilePath) {
              setIsSyncing(true);
              requestSync(relativeFilePath);
              const timer = setTimeout(() => {
                  if (!syncReceivedRef.current) {
                      setIsSyncing(false);
                      if (editor.getText().trim() === "") {
                          loadFromDisk();
                      }
                  }
              }, 250); 
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

  // -- Auto-detect Remote Logic --
  useEffect(() => {
    if (showSettings && rootPath) {
      invoke<string>("get_remote_origin", { path: rootPath })
        .then(setDetectedRemote)
        .catch(() => setDetectedRemote(""));
    }
  }, [showSettings, rootPath]);

  // -- Window Close Listener --
  useEffect(() => {
    const win = getCurrentWindow();
    const unlisten = win.onCloseRequested(async (event) => {
      const currentRoot = rootPathRef.current;
      const currentSsh = sshKeyPathRef.current;

      if (currentRoot && !pendingQuit) {
        event.preventDefault(); 
        
        // UI Feedback: Show user we are working
        setIsPushing(true);
        console.log("Window close requested. Attempting push...");

        try {
          // NOTE: sshKeyPath is passed even if empty (safe for agent usage)
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

  // -- Logic --

  const pushChanges = async (path: string) => {
    try {
      await invoke<string>("push_changes", { path, sshKeyPath: sshKeyPath || "" });
    } catch (e: any) {
      setWarningMsg(`Push failed: ${e}`);
      throw e; 
    }
  };

  const handleOpenFolder = async () => {
    if (rootPath) {
      try { await pushChanges(rootPath); } catch (e) { return; }
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
        {/* Sync/Push Overlay */}
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
              <BubbleMenu 
                className="bubble-menu" 
                editor={editor}
              >
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