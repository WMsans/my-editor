import { useEffect, useRef, useCallback } from "react";
import * as Y from "yjs"; 
import { invoke } from "@tauri-apps/api/core"; 

// Services & Stores
import { registry } from "./mod-engine/Registry";
import { workspaceManager, p2pService } from "./services";
import { useProjectStore } from "./stores/useProjectStore";
import { useSessionStore } from "./stores/useSessionStore";
import { useUIStore } from "./stores/useUIStore";

// Hooks
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
  
  // New Unified Session Store
  const { isHost, status, statusMessage } = useSessionStore();
  const { setWarningMsg } = useUIStore();

  const { 
      handleOpenFolder, handleNewFile, handleProjectReceived, 
      getRelativePath, isAutoJoining 
  } = useProject();

  // --- 1. Workspace Coordination ---
  useEffect(() => {
      const rel = getRelativePath(currentFilePath);
      workspaceManager.openFile(rel);
      if (currentFilePath) registry.emit('file:open', { path: currentFilePath });
  }, [currentFilePath, rootPath]); 

  // --- 2. P2P Event Bindings ---
  // We need to bind the "project-received" event from Transport to our Project Handler
  useEffect(() => {
      const unsub = p2pService.on('join-accepted', (data: number[]) => {
          handleProjectReceived(data);
      });
      return () => unsub();
  }, [handleProjectReceived]);

  // Use the refactored negotiation hook (now just triggers SessionService)
  useHostNegotiation();
  
  const { pendingQuit, isPushing, handleQuit, handleForceQuit } = useAppLifecycle();

  // --- 3. Editor Manager ---
  const { editor, currentDoc } = useEditorManager(currentFilePath, isHost, status === 'syncing');
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
            const name = prompt("Enter file name (e.g., page.md):");
            if (!name) return;
            const sep = rootPath.includes("\\") ? "\\" : "/";
            const newPath = `${rootPath}${sep}${name}`;
            
            // For new files, we manually write first, then open
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
        isJoining={status === 'negotiating'}
        isPushing={isPushing}
        isSyncing={status === 'syncing'}
        onNewFile={onNewFileClick}
        onOpenFolder={handleOpenFolder}
        onSave={handleSave}
        onQuit={handleQuit}
      />
    </>
  );
}

export default App;