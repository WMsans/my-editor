import { useState, useEffect } from "react";
import { EditorContent } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus" 
import { useCollaborativeEditor } from "./hooks/useCollaborativeEditor";
import { useP2P } from "./hooks/useP2P";
import { PeerList } from "./components/PeerList";
import { IncomingRequest } from "./components/IncomingRequest";
import { FileExplorer } from "./components/FileExplorer";
import { MenuBar } from "./components/MenuBar";
import { Settings } from "./components/Settings";
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
  const [remoteUrl, setRemoteUrl] = useState("");

  useEffect(() => {
    localStorage.setItem("sshKeyPath", sshKeyPath);
  }, [sshKeyPath]);

  // -- Logic --

  const pushChanges = async (path: string) => {
    if (!sshKeyPath) {
      console.log("No SSH key configured, skipping push");
      return;
    }
    console.log("Pushing changes to remote...");
    try {
      const res = await invoke<string>("push_changes", { path, sshKeyPath: sshKeyPath });
      console.log(res);
    } catch (e) {
      console.error("Push failed:", e);
      // Optional: alert user
      // alert("Push failed: " + e);
    }
  };

  const handleOpenFolder = async () => {
    // Push changes for the *current* folder before switching
    if (rootPath) {
      await pushChanges(rootPath);
    }

    const path = prompt("Enter absolute folder path to open:");
    if (path) {
      setRootPath(path);
      setFileSystemRefresh(prev => prev + 1);

      // Initialize Git Repo
      try {
        await invoke<string>("init_git_repo", { path });
      } catch (e) {
        console.log("Git Init status:", e);
      }
    }
  };

  const handleQuit = async () => {
    if (rootPath) {
      // Push changes before quitting
      await pushChanges(rootPath);
    }
    await getCurrentWindow().close();
  };

  const handleSaveRemote = async () => {
    if (!rootPath) return alert("Open a folder first");
    try {
      await invoke("set_remote_origin", { path: rootPath, url: remoteUrl });
      alert("Remote set successfully!");
    } catch (e) {
      alert("Failed to set remote: " + e);
    }
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
      alert("Error opening file: " + e);
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
      alert("Error saving: " + e);
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
        remoteUrl={remoteUrl}
        setRemoteUrl={setRemoteUrl}
        onSaveRemote={handleSaveRemote}
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