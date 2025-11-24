import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import * as Y from "yjs";

// Logic Hooks
import { useCollaborativeEditor } from "./hooks/useCollaborativeEditor";
import { useP2P } from "./hooks/useP2P";
import { useHostNegotiation } from "./hooks/useHostNegotiation";
import { useAppLifecycle } from "./hooks/useAppLifecycle";
import { documentRegistry } from "./mod-engine/DocumentRegistry";

// Components
import { MenuBar } from "./components/MenuBar";
import { Settings } from "./components/Settings";
import { WarningModal } from "./components/WarningModal";
import { Sidebar } from "./components/Sidebar";
import { EditorArea } from "./components/EditorArea";
import "./App.css";

const getRelativePath = (root: string, file: string | null) => {
  if (!root || !file) return null;
  if (file.startsWith(root)) {
    let rel = file.substring(root.length);
    if (rel.startsWith("/") || rel.startsWith("\\")) rel = rel.substring(1);
    return rel;
  }
  return file; 
};

function App() {
  // --- Global State ---
  const [rootPath, setRootPath] = useState<string>("");
  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null);
  const [fileSystemRefresh, setFileSystemRefresh] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [sshKeyPath, setSshKeyPath] = useState(localStorage.getItem("sshKeyPath") || "");
  const [detectedRemote, setDetectedRemote] = useState("");
  const [warningMsg, setWarningMsg] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  // --- Refs for Effects ---
  const rootPathRef = useRef(rootPath);
  const sshKeyPathRef = useRef(sshKeyPath);
  const isAutoJoining = useRef(false); 
  const currentFilePathRef = useRef(currentFilePath);
  const deadHostIdRef = useRef<string | null>(null);

  // --- Sync State to Refs ---
  useEffect(() => {
    rootPathRef.current = rootPath;
    documentRegistry.setRootPath(rootPath);
  }, [rootPath]);

  useEffect(() => {
    sshKeyPathRef.current = sshKeyPath;
    localStorage.setItem("sshKeyPath", sshKeyPath);
  }, [sshKeyPath]);
  
  useEffect(() => {
    currentFilePathRef.current = currentFilePath;
  }, [currentFilePath]);

  // --- P2P & Sync Logic ---
  const handleProjectReceived = useCallback(async (data: number[]) => {
    let destPath: string | null = null;
    let silent = false;

    if (isAutoJoining.current && rootPathRef.current) {
        destPath = rootPathRef.current;
        silent = true; 
        isAutoJoining.current = false; 
    } else {
        destPath = prompt("You joined a session! Enter absolute path to clone the project folder:");
    }

    if (destPath) {
      try {
        await invoke("save_incoming_project", { destPath, data });
        setRootPath(destPath);
        setFileSystemRefresh(prev => prev + 1);
        setDetectedRemote("");

        const activeFile = currentFilePathRef.current;
        if (activeFile) {
           setCurrentFilePath(null);
           setTimeout(() => setCurrentFilePath(activeFile), 50);
        }

        if (!silent) alert(`Project cloned to ${destPath}`);
      } catch (e) {
        setWarningMsg("Failed to save incoming project: " + e);
      }
    } else {
      setWarningMsg("Sync cancelled: No destination folder selected.");
    }
  }, []);

  const handleHostDisconnect = useCallback((hostId: string) => {
      deadHostIdRef.current = hostId;
  }, []);

  const handleFileSync = useCallback((syncedPath: string) => {
      const currentRel = getRelativePath(rootPathRef.current, currentFilePathRef.current);
      if (currentRel === syncedPath) {
          setIsSyncing(false);
      }
  }, []);

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

  // --- App Lifecycle Hook (Quit/Push) ---
  const { 
    pendingQuit, setPendingQuit, isPushing, handleQuit, handleForceQuit 
  } = useAppLifecycle({
    rootPathRef,
    sshKeyPathRef,
    isHostRef,
    setWarningMsg
  });

  // --- Editor & Document Logic ---
  const relativeFilePath = getRelativePath(rootPath, currentFilePath);
  const [currentDoc, setCurrentDoc] = useState<Y.Doc | null>(null);
  
  const { editor } = useCollaborativeEditor(currentDoc);

  useEffect(() => {
    if (editor) {
      editor.setEditable(!isJoining);
    }
  }, [editor, isJoining]);

  useEffect(() => {
    if (relativeFilePath) {
      const doc = documentRegistry.getOrCreateDoc(relativeFilePath);
      setCurrentDoc(doc);
      if (!isHost && requestSync) {
        requestSync(relativeFilePath);
        setIsSyncing(true);
      } else {
        setIsSyncing(false);
      }
    } else {
      setCurrentDoc(null);
    }
  }, [relativeFilePath, isHost, requestSync]);

  // --- Settings & Git Remote ---
  useEffect(() => {
    if (showSettings && rootPath) {
      invoke<string>("get_remote_origin", { path: rootPath })
        .then(setDetectedRemote)
        .catch(() => setDetectedRemote(""));
    }
  }, [showSettings, rootPath]);

  // --- Handlers ---
  const handleOpenFolder = async () => {
    if (rootPath) {
      try { 
        await invoke("push_changes", { path: rootPath, sshKeyPath: sshKeyPath || "" }); 
      } catch (e) { 
        console.error("Failed to push changes for previous folder, but proceeding anyway:", e);
      }
    }

    setTimeout(() => {
      try {
        const path = prompt("Enter absolute folder path to open:");
        if (path) {
          setRootPath(path);
          setFileSystemRefresh(prev => prev + 1);
          setDetectedRemote("");
          try {
            invoke<string>("init_git_repo", { path });
            invoke<string>("get_remote_origin", { path }).then(setDetectedRemote);
          } catch (e) {
            console.log("Git Init/Check status:", e);
          }
        }
      } catch (e) {
        setWarningMsg("Could not open folder prompt: " + e);
      }
    }, 50);
  };

  const handleNewFile = () => {
    setCurrentFilePath(null);
    editor?.commands.clearContent();
  };

  return (
    <div className="app-layout">
      <MenuBar 
        onNew={handleNewFile}
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