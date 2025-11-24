import { useState, useEffect, useRef, useCallback } from "react";

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
import { Sidebar } from "./components/Sidebar";
import { EditorArea } from "./components/EditorArea";
import "./App.css";

function App() {
  // --- UI State ---
  const [showSettings, setShowSettings] = useState(false);
  const [warningMsg, setWarningMsg] = useState<string | null>(null);
  const deadHostIdRef = useRef<string | null>(null);

  // --- Project & File System Hook ---
  const {
    rootPath, rootPathRef,
    currentFilePath, setCurrentFilePath, currentFilePathRef,
    fileSystemRefresh,
    sshKeyPath, setSshKeyPath, sshKeyPathRef,
    detectedRemote, refreshRemoteOrigin,
    isAutoJoining,
    handleOpenFolder, handleNewFile, handleProjectReceived,
    getRelativePath
  } = useProject(setWarningMsg);

  // --- P2P Callbacks ---
  const handleHostDisconnect = useCallback((hostId: string) => {
      deadHostIdRef.current = hostId;
  }, []);
  
  // We will create a mutable ref to hold the setIsSyncing function so we can pass it to callbacks
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
    sendJoinRequest, acceptRequest, rejectRequest, requestSync, myAddresses 
  } = useP2P(handleProjectReceived, handleHostDisconnect, handleFileSync);

  const isHostRef = useRef(isHost);
  useEffect(() => { isHostRef.current = isHost; }, [isHost]);

  // --- Host Negotiation Hook ---
  useHostNegotiation({
    rootPath,
    myPeerId,
    myAddresses,
    sshKeyPathRef,
    isHost,
    deadHostIdRef,
    isAutoJoiningRef: isAutoJoining,
    sendJoinRequest,
    setStatus,
    setWarningMsg
  });

  // --- App Lifecycle Hook ---
  const { 
    pendingQuit, setPendingQuit, isPushing, handleQuit, handleForceQuit 
  } = useAppLifecycle({
    rootPathRef,
    sshKeyPathRef,
    isHostRef,
    setWarningMsg
  });

  // --- Editor Manager Hook ---
  const { editor, isSyncing, setIsSyncing } = useEditorManager(
    rootPath,
    currentFilePath,
    getRelativePath,
    isHost,
    isJoining,
    requestSync
  );

  // Update the ref so handleFileSync can use it
  useEffect(() => { setIsSyncingRef.current = setIsSyncing; }, [setIsSyncing]);

  // --- Settings Effect ---
  useEffect(() => {
    if (showSettings) refreshRemoteOrigin();
  }, [showSettings, refreshRemoteOrigin]);

  // --- Wrapper for New File to clear editor ---
  const onNewFileClick = () => {
    handleNewFile();
    editor?.commands.clearContent();
  };

  return (
    <div className="app-layout">
      <MenuBar 
        onNew={onNewFileClick}
        onOpenFolder={handleOpenFolder}
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