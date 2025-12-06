import { useEffect, useRef, useCallback } from "react";
import * as Y from "yjs"; 
import { invoke } from "@tauri-apps/api/core"; 

// Engine & Stores
import { registry } from "./mod-engine/Registry";
import { documentRegistry } from "./mod-engine/DocumentRegistry"; 
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
  // --- 1. Store Access ---
  const { rootPath, currentFilePath, setCurrentFilePath, triggerFileSystemRefresh } = useProjectStore();
  const { isHost, isJoining, isSyncing, setIsSyncing } = useP2PStore();
  const { setWarningMsg } = useUIStore();

  // --- 2. Logic Controllers ---
  const { 
      handleOpenFolder, handleNewFile, handleProjectReceived, 
      getRelativePath, isAutoJoining 
  } = useProject();

  // P2P: Glue logic for syncing state
  const currentFilePathRef = useRef(currentFilePath);
  useEffect(() => { currentFilePathRef.current = currentFilePath; }, [currentFilePath]);
  
  const setIsSyncingRef = useRef<(v: boolean) => void>(() => {});
  useEffect(() => { setIsSyncingRef.current = setIsSyncing; }, [setIsSyncing]);

  const handleFileSync = useCallback((syncedPath: string) => {
      const currentRel = getRelativePath(currentFilePathRef.current);
      if (currentRel === syncedPath) setIsSyncingRef.current(false);
  }, [getRelativePath]);

  const { sendJoinRequest, requestSync } = useP2P(handleProjectReceived, handleFileSync);

  // Negotiation & Lifecycle
  useHostNegotiation(isAutoJoining, sendJoinRequest);
  const { pendingQuit, isPushing, handleQuit, handleForceQuit } = useAppLifecycle();

  // Editor Manager
  const { editor, currentDoc } = useEditorManager(
    rootPath, currentFilePath, getRelativePath, isHost, isJoining, requestSync
  );
  
  // Keep a ref of the editor for the HostAPI (accessed in bootstrap)
  const editorRef = useRef(editor);
  useEffect(() => { editorRef.current = editor; }, [editor]);

  // --- 3. Bootstrap Engine ---
  const { isAppReady, loadError } = useAppBootstrap(editorRef);

  // --- 4. Global Event Listeners ---
  useEffect(() => {
    if (currentFilePath) registry.emit('file:open', { path: currentFilePath });
  }, [currentFilePath]);

  // --- 5. Handlers ---
  const onNewFileClick = () => {
    handleNewFile();
    editor?.commands.clearContent();
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
            const relPath = getRelativePath(currentFilePath);
            if (relPath) {
                await documentRegistry.manualSave(relPath);
                registry.emit('file:save', { path: currentFilePath });
            }
        } else {
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
      <GlobalModalManager 
        pendingQuit={pendingQuit} 
        onForceQuit={handleForceQuit} 
      />
      
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