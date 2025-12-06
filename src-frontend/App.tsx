import { useState, useEffect, useRef, useCallback } from "react";
import * as Y from "yjs"; 
import { invoke } from "@tauri-apps/api/core"; 
import { appLocalDataDir, join } from '@tauri-apps/api/path';
import { documentRegistry } from "./mod-engine/DocumentRegistry"; 

// API & Registry
import { registry } from "./mod-engine/Registry";
import { createHostAPI } from "./mod-engine/HostAPIImpl";
import { pluginLoader } from "./mod-engine/PluginLoader";

// Stores & Hooks
import { useProjectStore } from "./stores/useProjectStore";
import { useP2PStore } from "./stores/useP2PStore";
import { useUIStore } from "./stores/useUIStore";
import { useP2P } from "./hooks/useP2P";
import { useHostNegotiation } from "./hooks/useHostNegotiation";
import { useAppLifecycle } from "./hooks/useAppLifecycle";
import { useProject } from "./hooks/useProject";
import { useEditorManager } from "./hooks/useEditorManager";

// Components
import { MenuBar } from "./components/MenuBar";
import { Settings } from "./components/Settings";
import { WarningModal } from "./components/WarningModal";
import { PasswordModal } from "./components/PasswordModal";
import { Sidebar } from "./components/Sidebar";
import { EditorArea } from "./components/EditorArea";
import "./App.css";

function App() {
  // Store Access
  const { rootPath, currentFilePath, setCurrentFilePath, triggerFileSystemRefresh } = useProjectStore();
  const { isHost, isJoining, isSyncing, setIsSyncing } = useP2PStore();
  const { setWarningMsg } = useUIStore();

  // Lifecycle State
  const [isAppReady, setIsAppReady] = useState(false);
  const [loadError, setLoadError] = useState<string|null>(null);

  // --- Logic Hooks (Controllers) ---
  const {
    isAutoJoining,
    handleOpenFolder,
    handleNewFile,
    handleProjectReceived,
    getRelativePath,
    refreshRemoteOrigin
  } = useProject();

  // P2P Controller
  const setIsSyncingRef = useRef<(v: boolean) => void>(() => {});
  const currentFilePathRef = useRef(currentFilePath);
  useEffect(() => { currentFilePathRef.current = currentFilePath; }, [currentFilePath]);

  const handleFileSync = useCallback((syncedPath: string) => {
      const currentRel = getRelativePath(currentFilePathRef.current);
      if (currentRel === syncedPath) {
          setIsSyncingRef.current(false);
      }
  }, [getRelativePath]);

  const { sendJoinRequest, requestSync } = useP2P(handleProjectReceived, handleFileSync);
  
  // Host Negotiation Controller
  const { updateProjectKey } = useHostNegotiation(isAutoJoining, sendJoinRequest);

  // App Lifecycle Controller
  const { pendingQuit, isPushing, handleQuit, handleForceQuit } = useAppLifecycle();

  // Editor Manager
  const { editor, currentDoc } = useEditorManager(
    rootPath,
    currentFilePath,
    getRelativePath,
    isHost,
    isJoining,
    requestSync
  );

  // --- Global Event Links ---
  useEffect(() => {
    if (currentFilePath) {
      registry.emit('file:open', { path: currentFilePath });
    }
  }, [currentFilePath]);

  useEffect(() => { setIsSyncingRef.current = setIsSyncing; }, [setIsSyncing]);

  // --- Initialization ---
  const editorRef = useRef(editor);
  useEffect(() => { editorRef.current = editor; }, [editor]);

  useEffect(() => {
    let isMounted = true; 
    const initEngine = async () => {
      try {
        if (!isMounted) return;
        const api = createHostAPI(
          () => editorRef.current, 
          () => useProjectStore.getState().rootPath,
          setWarningMsg,
          {
            getAll: async () => pluginLoader.getAllManifests(),
            isEnabled: (id) => pluginLoader.isPluginEnabled(id),
            setEnabled: (id, val) => pluginLoader.setPluginEnabled(id, val)
          }
        );
        // @ts-ignore
        window.CollabAPI = api;
        
        registry.init(api);
        registry.registerCommand("file.open", (path: string) => {
          if (typeof path === 'string') setCurrentFilePath(path);
        });
        registry.registerCommand("window.reload", () => window.location.reload());

        const appDataPath = await appLocalDataDir();
        const pluginsDir = await join(appDataPath, 'plugins');
        console.log(`🔌 Scanning for plugins in: ${pluginsDir}`);
        
        const manifests = await pluginLoader.discoverPlugins(pluginsDir);
        if (!isMounted) return; 

        await pluginLoader.registerStaticContributions(manifests);
        await pluginLoader.loadPlugins(api, manifests);
        
        if (isMounted) setIsAppReady(true);
      } catch (e: any) {
        if (isMounted) setLoadError(e.toString());
      }
    };
    initEngine();
    return () => { isMounted = false; pluginLoader.deactivateAll(); };
  }, [setCurrentFilePath, setWarningMsg]);

  // --- Action Handlers ---
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
    <div className="app-layout">
      <MenuBar 
        onNew={onNewFileClick}
        onOpenFolder={handleOpenFolder}
        onQuit={handleQuit}
        onSave={handleSave}
      />
      
      <Settings />
      <PasswordModal />

      <WarningModal 
        onConfirm={pendingQuit ? handleForceQuit : undefined}
        confirmText="Quit Anyway"
      />

      <div className="main-workspace">
        <Sidebar />
        <EditorArea 
          editor={editor}
          isJoining={isJoining}
          isPushing={isPushing}
          isSyncing={isSyncing}
        />
      </div>
    </div>
  );
}

export default App;