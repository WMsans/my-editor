import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog"; 
import { documentRegistry } from "../mod-engine/DocumentRegistry";

export function useProject(setWarningMsg: (msg: string | null) => void) {
  // State
  const [rootPath, setRootPath] = useState<string>("");
  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null);
  const [fileSystemRefresh, setFileSystemRefresh] = useState(0);
  const [sshKeyPath, setSshKeyPath] = useState(localStorage.getItem("sshKeyPath") || "");
  const [detectedRemote, setDetectedRemote] = useState("");

  // Refs
  const rootPathRef = useRef(rootPath);
  const sshKeyPathRef = useRef(sshKeyPath);
  const currentFilePathRef = useRef(currentFilePath);
  const isAutoJoining = useRef(false);

  // Sync Refs & Registry
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

  // Helper: Get Relative Path
  const getRelativePath = useCallback((file: string | null) => {
    const root = rootPathRef.current;
    if (!root || !file) return null;
    if (file.startsWith(root)) {
      let rel = file.substring(root.length);
      if (rel.startsWith("/") || rel.startsWith("\\")) rel = rel.substring(1);
      return rel;
    }
    return file; 
  }, []);

  // Action: Refresh Remote Origin
  const refreshRemoteOrigin = useCallback(async () => {
    if (rootPath) {
        try {
            const remote = await invoke<string>("get_remote_origin", { path: rootPath });
            setDetectedRemote(remote);
        } catch {
            setDetectedRemote("");
        }
    }
  }, [rootPath]);

  // Action: Open Folder
  const handleOpenFolder = async () => {
    if (rootPath) {
      try { 
        await invoke("push_changes", { path: rootPath, sshKeyPath: sshKeyPath || "" }); 
      } catch (e) { 
        console.error("Failed to push changes for previous folder, but proceeding anyway:", e);
      }
    }

    // 2. Replace setTimeout/prompt with native dialog
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Open Project Folder"
      });

      // In Tauri v2, 'selected' is null if cancelled, or a string path
      if (selected && typeof selected === 'string') {
        setRootPath(selected);
        setFileSystemRefresh(prev => prev + 1);
        setDetectedRemote("");
        try {
          await invoke("init_git_repo", { path: selected });
          const remote = await invoke<string>("get_remote_origin", { path: selected });
          setDetectedRemote(remote);
        } catch (e) {
          console.log("Git Init/Check status:", e);
        }
      }
    } catch (e) {
      setWarningMsg("Could not open folder dialog: " + e);
    }
  };

  // Action: Handle Incoming Project (P2P)
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
  }, [setWarningMsg]);

  const handleNewFile = useCallback(() => {
    setCurrentFilePath(null);
  }, []);

  return {
    rootPath, setRootPath, rootPathRef,
    currentFilePath, setCurrentFilePath, currentFilePathRef,
    fileSystemRefresh, setFileSystemRefresh,
    sshKeyPath, setSshKeyPath, sshKeyPathRef,
    detectedRemote, refreshRemoteOrigin,
    isAutoJoining,
    handleOpenFolder,
    handleNewFile,
    handleProjectReceived,
    getRelativePath
  };
}