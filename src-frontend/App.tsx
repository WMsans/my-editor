import { useState, useEffect, useRef, useCallback } from "react";
import * as Y from "yjs"; 
import { invoke } from "@tauri-apps/api/core"; 
import { documentRegistry } from "./mod-engine/DocumentRegistry"; 

// API & Registry
import { registry } from "./mod-engine/Registry";
import { createHostAPI } from "./mod-engine/HostAPIImpl";
import { pluginLoader } from "./mod-engine/PluginLoader";

// Logic Hooks
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
  // --- UI State ---
  const [showSettings, setShowSettings] = useState(false);
  const [warningMsg, setWarningMsg] = useState<string | null>(null);
  const deadHostIdRef = useRef<string | null>(null);

  // --- Password Modal State ---
  const [passwordRequest, setPasswordRequest] = useState<{
    message: string;
    resolve: (val: string | null) => void;
  } | null>(null);

  // --- Encryption State ---
  const [encryptionKey, setEncryptionKey] = useState(localStorage.getItem("encryptionKey") || "");
  const encryptionKeyRef = useRef(encryptionKey);

  // --- App Lifecycle State ---
  const [isAppReady, setIsAppReady] = useState(false);
  const [loadError, setLoadError] = useState<string|null>(null);

  // Sync Encryption Key Ref
  useEffect(() => {
    encryptionKeyRef.current = encryptionKey;
    localStorage.setItem("encryptionKey", encryptionKey);
  }, [encryptionKey]);

  // --- Project & File System Hook ---
  const {
    rootPath, rootPathRef,
    currentFilePath, setCurrentFilePath, currentFilePathRef,
    fileSystemRefresh, setFileSystemRefresh,
    sshKeyPath, setSshKeyPath, sshKeyPathRef,
    detectedRemote, refreshRemoteOrigin,
    isAutoJoining,
    handleOpenFolder, handleNewFile, handleProjectReceived,
    getRelativePath
  } = useProject(setWarningMsg);

  // --- EVENT: Emit file:open ---
  useEffect(() => {
    if (currentFilePath) {
      registry.emit('file:open', { path: currentFilePath });
    }
  }, [currentFilePath]);

  // --- P2P Callbacks ---
  const handleHostDisconnect = useCallback((hostId: string) => {
      deadHostIdRef.current = hostId;
  }, []);
  
  const setIsSyncingRef = useRef<(v: boolean) => void>(() => {});

  const handleFileSync = useCallback((syncedPath: string) => {
      const currentRel = getRelativePath(currentFilePathRef.current);
      if (currentRel === syncedPath) {
          setIsSyncingRef.current(false);
      }
  }, [getRelativePath]);

  // --- P2P Hook ---
  const { 
    myPeerId, incomingRequest, isHost, isJoining, status, setStatus,
    sendJoinRequest, acceptRequest, rejectRequest, requestSync, myAddresses,
    connectedPeers
  } = useP2P(handleProjectReceived, handleHostDisconnect, handleFileSync);

  const isHostRef = useRef(isHost);
  useEffect(() => { isHostRef.current = isHost; }, [isHost]);

  useEffect(() => {
    documentRegistry.setIsHost(isHost);
  }, [isHost]);

  const connectedPeersRef = useRef(connectedPeers);
  useEffect(() => { connectedPeersRef.current = connectedPeers; }, [connectedPeers]);

  // --- Password Request Handler (Promisified) ---
  const requestPassword = useCallback((message: string) => {
    return new Promise<string | null>((resolve) => {
      setPasswordRequest({ message, resolve });
    });
  }, []);

  const handlePasswordSubmit = (password: string) => {
    if (passwordRequest) {
      passwordRequest.resolve(password);
      setPasswordRequest(null);
    }
  };

  const handlePasswordCancel = () => {
    if (passwordRequest) {
      passwordRequest.resolve(null);
      setPasswordRequest(null);
    }
  };

  // --- Host Negotiation Hook ---
  useHostNegotiation({
    rootPath,
    myPeerId,
    myAddresses,
    sshKeyPathRef,
    encryptionKeyRef,
    setEncryptionKey,
    isHost,
    deadHostIdRef,
    isAutoJoiningRef: isAutoJoining,
    sendJoinRequest,
    setStatus,
    setWarningMsg,
    requestPassword
  });

  // --- App Lifecycle Hook ---
  const { 
    pendingQuit, setPendingQuit, isPushing, handleQuit, handleForceQuit 
  } = useAppLifecycle({
    rootPathRef,
    sshKeyPathRef,
    isHostRef,
    setWarningMsg,
    connectedPeersRef
  });

  // --- Editor Manager Hook ---
  const { editor, isSyncing, setIsSyncing, currentDoc } = useEditorManager(
    rootPath,
    currentFilePath,
    getRelativePath,
    isHost,
    isJoining,
    requestSync
  );

  // --- [NEW] API & Plugin Initialization ---
  const editorRef = useRef(editor);
  useEffect(() => { editorRef.current = editor; }, [editor]);

  useEffect(() => {
    let isMounted = true; 

    const initEngine = async () => {
      try {
        if (!isMounted) return;

        // A. Setup Host API
        const api = createHostAPI(
          () => editorRef.current, 
          () => rootPathRef.current,
          setWarningMsg,
          {
            getAll: async () => pluginLoader.getAllManifests(),
            isEnabled: (id) => pluginLoader.isPluginEnabled(id),
            setEnabled: (id, val) => pluginLoader.setPluginEnabled(id, val)
          }
        );
        // @ts-ignore
        window.CollabAPI = api;
        
        // Clear registry before loading
        registry.init(api);

        // B. Discover Plugins
        const pluginsDir = "../plugins"; 
        
        const manifests = await pluginLoader.discoverPlugins(pluginsDir);
        if (!isMounted) return; 

        // [CHANGED] Phase 1: Register Static Contributions first
        // This populates UI icons/commands without running JS
        await pluginLoader.registerStaticContributions(manifests);

        // [OPTIONAL] We still load JS for now to maintain functionality
        // but the architecture now supports static-only init.
        await pluginLoader.loadPlugins(api, manifests);
        
        if (!isMounted) return; 

        // C. Ready
        setIsAppReady(true);
      } catch (e: any) {
        if (isMounted) setLoadError(e.toString());
      }
    };

    initEngine();

    // Cleanup: Cancel any pending loads
    return () => {
      isMounted = false;
      pluginLoader.deactivateAll();
    };
  }, []); // Deps: Empty array (run once)

  useEffect(() => { setIsSyncingRef.current = setIsSyncing; }, [setIsSyncing]);
  useEffect(() => { if (showSettings) refreshRemoteOrigin(); }, [showSettings, refreshRemoteOrigin]);

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
        setWarningMsg("Guests cannot save or create files on disk directly. Your changes are synced to the Host automatically.");
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
            await invoke("write_file_content", { 
                path: newPath, 
                content: Array.from(content) 
            });
            setFileSystemRefresh(prev => prev + 1);
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
        onSettings={() => setShowSettings(true)}
        onQuit={handleQuit}
        onSave={handleSave}
        currentFile={currentFilePath}
      />
      
      <Settings 
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        sshKeyPath={sshKeyPath}
        setSshKeyPath={setSshKeyPath}
        encryptionKey={encryptionKey}
        setEncryptionKey={setEncryptionKey}
        detectedRemote={detectedRemote}
      />

      <PasswordModal 
        isOpen={!!passwordRequest}
        message={passwordRequest?.message || ""}
        onSubmit={handlePasswordSubmit}
        onCancel={handlePasswordCancel}
      />

      <WarningModal 
        isOpen={!!warningMsg}
        message={warningMsg || ""}
        onClose={() => { setWarningMsg(null); setPendingQuit(false); }}
        onConfirm={pendingQuit ? handleForceQuit : undefined}
        confirmText="Quit Anyway"
      />

      <div className="main-workspace">
        <Sidebar 
          rootPath={rootPath}
          onOpenFile={setCurrentFilePath}
          fileSystemRefresh={fileSystemRefresh}
          isHost={isHost}
          status={status}
          incomingRequest={incomingRequest}
          onAcceptRequest={() => acceptRequest(rootPath)}
          onRejectRequest={rejectRequest}
        />

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