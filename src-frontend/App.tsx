// src-frontend/App.tsx
import { useState, useEffect, useRef, useCallback } from "react";
import * as Y from "yjs"; // Import Yjs
import { invoke } from "@tauri-apps/api/core"; // Import invoke
import { documentRegistry } from "./mod-engine/DocumentRegistry"; // Import Registry

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
    fileSystemRefresh, setFileSystemRefresh,
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
  // Now returns currentDoc
  const { editor, isSyncing, setIsSyncing, currentDoc } = useEditorManager(
    rootPath,
    currentFilePath,
    getRelativePath,
    isHost,
    isJoining,
    requestSync
  );

  useEffect(() => { setIsSyncingRef.current = setIsSyncing; }, [setIsSyncing]);
  useEffect(() => { if (showSettings) refreshRemoteOrigin(); }, [showSettings, refreshRemoteOrigin]);

  const onNewFileClick = () => {
    handleNewFile();
    editor?.commands.clearContent();
  };

  // --- Handle Save Logic ---
  const handleSave = async () => {
    if (!rootPath) {
        setWarningMsg("Cannot save: No project folder opened.");
        return;
    }

    try {
        if (currentFilePath) {
            // Save existing file
            const relPath = getRelativePath(currentFilePath);
            if (relPath) {
                await documentRegistry.manualSave(relPath);
                // Optionally show a "Saved" toast here
            }
        } else {
            // Save new file (Save As)
            const name = prompt("Enter file name (e.g., page.md):");
            if (!name) return;

            const sep = rootPath.includes("\\") ? "\\" : "/";
            const newPath = `${rootPath}${sep}${name}`;
            
            // Encode the content of the current (untitled) document
            const content = Y.encodeStateAsUpdate(currentDoc);

            // Write to disk
            await invoke("write_file_content", { 
                path: newPath, 
                content: Array.from(content) 
            });

            // Update state to point to the new file
            // Trigger refresh to show in sidebar
            setFileSystemRefresh(prev => prev + 1);
            setCurrentFilePath(newPath);
        }
    } catch (e: any) {
        setWarningMsg(`Failed to save file: ${e.toString()}`);
    }
  };

  return (
    <div className="app-layout">
      <MenuBar 
        onNew={onNewFileClick}
        onOpenFolder={handleOpenFolder}
        onSettings={() => setShowSettings(true)}
        onQuit={handleQuit}
        onSave={handleSave} // Pass the save handler
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