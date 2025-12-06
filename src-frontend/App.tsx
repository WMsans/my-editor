import { useEffect, useRef, useCallback } from "react";
import * as Y from "yjs"; 
import { invoke } from "@tauri-apps/api/core"; 

// Services & Stores
import { registry } from "./mod-engine/Registry";
import { workspaceManager } from "./services"; // [CHANGED]
import { useProjectStore } from "./stores/useProjectStore";
import { useP2PStore } from "./stores/useP2PStore";
import { useUIStore } from "./stores/useUIStore";

// Hooks
import { useP2P } from "./hooks/useP2P";
import { useHostNegotiation } from "./hooks/useHostNegotiation";
import { useAppLifecycle } from "./hooks/useAppLifecycle";
import { useProject } from "./hooks/useProject";
import { useEditorManager } from "./hooks/useEditorManager";
import { useAppBootstrap } from "./hooks/useAppBootstrap";

// Layout & Components
import { MainLayout } from "./components/MainLayout";
import { GlobalModalManager } from "./components/GlobalModalManager";
import "./App.css";

function App() {
  const { rootPath, currentFilePath, setCurrentFilePath, triggerFileSystemRefresh } = useProjectStore();
  const { isHost, isJoining, isSyncing, setIsSyncing } = useP2PStore();
  const { setWarningMsg } = useUIStore();

  const { 
      handleOpenFolder, handleNewFile, handleProjectReceived, 
      getRelativePath, isAutoJoining 
  } = useProject();

  // --- 1. Workspace Coordination ---
  // When current file changes in Store, tell Manager to open it
  useEffect(() => {
      const rel = getRelativePath(currentFilePath);
      workspaceManager.openFile(rel);
      if (currentFilePath) registry.emit('file:open', { path: currentFilePath });
  }, [currentFilePath, rootPath]); // dependency on rootPath ensures re-calc

  // --- 2. P2P & Sync ---
  const handleFileSync = useCallback((syncedPath: string) => {
      // UI update only
      if (getRelativePath(currentFilePath) === syncedPath) setIsSyncing(false);
  }, [currentFilePath, getRelativePath, setIsSyncing]);

  const { sendJoinRequest, requestSync } = useP2P(handleProjectReceived, handleFileSync);
  
  // Negotiation & Lifecycle
  useHostNegotiation(isAutoJoining, sendJoinRequest);
  const { pendingQuit, isPushing, handleQuit, handleForceQuit } = useAppLifecycle();

  // --- 3. Editor Manager (View Controller) ---
  const { editor, currentDoc } = useEditorManager(currentFilePath, isHost, isJoining);
  
  // Keep a ref for HostAPI
  const editorRef = useRef(editor);
  useEffect(() => { editorRef.current = editor; }, [editor]);

  const { isAppReady, loadError } = useAppBootstrap(editorRef);

  // --- 4. Handlers ---
  const onNewFileClick = () => {
    handleNewFile();
    registry.emit('file:new');
  };

  const handleSave = async () => {
    if (!rootPath) {
        setWarningMsg("Cannot save: No project folder opened.");
        return;
    }
    if (!isHost) {
        setWarningMsg("Guests cannot save directly. Changes are synced to Host.");
        return;
    }
    try {
        if (currentFilePath) {
            await workspaceManager.saveCurrentFile();
            registry.emit('file:save', { path: currentFilePath });
        } else {
            // New File Creation Logic (still largely UI driven for prompts)
            const name = prompt("Enter file name (e.g., page.md):");
            if (!name) return;
            const sep = rootPath.includes("\\") ? "\\" : "/";
            const newPath = `${rootPath}${sep}${name}`;
            const content = Y.encodeStateAsUpdate(currentDoc);
            await invoke("write_file_content", { path: newPath, content: Array.from(content) });
            triggerFileSystemRefresh();
            setCurrentFilePath(newPath);
            registry.emit('file:save', { path: newPath });
        }
    } catch (e: any) {
        setWarningMsg(`Failed to save file: ${e.toString()}`);
    }
  };

  if (!isAppReady) {
    return (
      <div className="app-loading">
        <h2>Initializing Collaboration Engine...</h2>
        {loadError && <p style={{color: 'red'}}>Error: {loadError}</p>}
        <div className="loader">Loading Plugins...</div>
      </div>
    );
  }

  return (
    <>
      <GlobalModalManager pendingQuit={pendingQuit} onForceQuit={handleForceQuit} />
      <MainLayout 
        editor={editor}
        isJoining={isJoining}
        isPushing={isPushing}
        isSyncing={isSyncing}
        onNewFile={onNewFileClick}
        onOpenFolder={handleOpenFolder}
        onSave={handleSave}
        onQuit={handleQuit}
      />
    </>
  );
}

export default App;