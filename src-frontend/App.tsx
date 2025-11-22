import { useState, useEffect, useRef } from "react";
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

function App() {
  const { editor, ydoc } = useCollaborativeEditor();
  const { 
    peers, 
    incomingRequest, 
    isHost, 
    status, 
    sendJoinRequest, 
    acceptRequest, 
    rejectRequest 
  } = useP2P(ydoc);

  const [rootPath, setRootPath] = useState<string>("");
  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null);
  const [fileSystemRefresh, setFileSystemRefresh] = useState(0);
  
  // Settings State
  const [showSettings, setShowSettings] = useState(false);
  const [sshKeyPath, setSshKeyPath] = useState(localStorage.getItem("sshKeyPath") || "");
  const [detectedRemote, setDetectedRemote] = useState("");
  
  // Warning State
  const [warningMsg, setWarningMsg] = useState<string | null>(null);
  const [pendingQuit, setPendingQuit] = useState(false);

  // Refs for usage inside event listeners
  const rootPathRef = useRef(rootPath);
  const sshKeyPathRef = useRef(sshKeyPath);

  useEffect(() => {
    rootPathRef.current = rootPath;
  }, [rootPath]);

  useEffect(() => {
    sshKeyPathRef.current = sshKeyPath;
    localStorage.setItem("sshKeyPath", sshKeyPath);
  }, [sshKeyPath]);

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

      // If we haven't tried pushing yet and we have a root path
      if (currentRoot && !pendingQuit) {
        event.preventDefault(); // Stop closing
        
        console.log("Window close requested. Attempting push...");
        try {
          // Attempt Push
          if (!currentSsh) throw new Error("SSH Key path not set in Settings.");
          await invoke("push_changes", { path: currentRoot, sshKeyPath: currentSsh });
          
          // Success? Close for real.
          await win.destroy();
        } catch (e: any) {
          // Fail? Show warning.
          setWarningMsg(`Failed to push changes before quitting:\n\n${e}\n\nQuit anyway?`);
          setPendingQuit(true); // Allow the "Quit Anyway" button to work
        }
      }
      // If pendingQuit is true, we let the user handle it via the modal (Quit Anyway)
      // or if they clicked X again, we might want to block it again unless they force quit.
      else if (pendingQuit) {
         // If the modal is already open, prevent default to avoid accidental close if they spam X
         // But generally we want the Modal buttons to drive action.
         event.preventDefault();
      }
    });

    return () => { unlisten.then(f => f()); };
  }, [pendingQuit]); // Re-bind if pendingQuit changes, though refs handle data

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
    // Push changes for the *current* folder before switching
    if (rootPath) {
      try {
        await pushChanges(rootPath);
      } catch (e) {
        // If push fails, we show warning but allow user to continue via modal interaction logic if we wanted.
        // For now, the warning pops up, but we still proceed to prompt? 
        // Better: return and let user see warning.
        return; 
      }
    }

    const path = prompt("Enter absolute folder path to open:");
    if (path) {
      setRootPath(path);
      setFileSystemRefresh(prev => prev + 1);
      setDetectedRemote(""); // Reset

      // Initialize Git Repo
      try {
        await invoke<string>("init_git_repo", { path });
        // Check remote immediately
        const remote = await invoke<string>("get_remote_origin", { path });
        setDetectedRemote(remote);
      } catch (e) {
        console.log("Git Init/Check status:", e);
      }
    }
  };

  const handleQuit = async () => {
    const win = getCurrentWindow();
    // This triggers the onCloseRequested event we hooked above
    await win.close();
  };

  const handleForceQuit = async () => {
    await getCurrentWindow().destroy();
  };

  const handleOpenFile = async (path: string) => {
    try {
      const content = await invoke<string>("read_file_content", { path });
      try {
        const jsonContent = JSON.parse(content);
        if (jsonContent.type === 'doc' && Array.isArray(jsonContent.content)) {
          editor?.commands.setContent(jsonContent);
        } else {
          throw new Error("Not a valid block document");
        }
      } catch (e) {
        editor?.commands.setContent(content, { contentType: 'markdown' });
      }
      setCurrentFilePath(path);
    } catch (e) {
      setWarningMsg("Error opening file: " + e);
    }
  };

  const handleNewFile = () => {
    editor?.commands.clearContent();
    setCurrentFilePath(null);
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
                  onAccept={acceptRequest} 
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