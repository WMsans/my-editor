import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog"; 
import { documentRegistry } from "../mod-engine/DocumentRegistry";
import { pluginLoader } from "../mod-engine/PluginLoader";

const META_FILE = ".collab_meta.json";

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

    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Open Project Folder"
      });

      if (selected && typeof selected === 'string') {
        // [CHECK] Validate Plugins before opening
        const sep = selected.includes("\\") ? "\\" : "/";
        const metaPath = `${selected}${sep}${META_FILE}`;
        try {
            const contentBytes = await invoke<number[]>("read_file_content", { path: metaPath });
            const content = new TextDecoder().decode(new Uint8Array(contentBytes));
            const json = JSON.parse(content);
            if (json.requiredPlugins && Array.isArray(json.requiredPlugins)) {
                const missing = pluginLoader.checkMissingRequirements(json.requiredPlugins);
                if (missing.length > 0) {
                     setWarningMsg(`Cannot open project.\n\nMissing universally required plugins:\n- ${missing.join('\n- ')}\n\nPlease install/enable them and try again.`);
                     return;
                }
            }
        } catch (e) {
            // Ignore (Meta file likely missing, which is fine)
        }

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
        // [FIX] Use native dialog to select folder instead of prompt
        const selected = await open({
            directory: true,
            multiple: false,
            title: "Select Destination for Shared Project"
        });
        if (selected && typeof selected === 'string') {
            destPath = selected;
        }
    }

    if (destPath) {
      try {
        await invoke("save_incoming_project", { destPath, data });

        // [CHECK] Validate Plugins after receiving
        const sep = destPath.includes("\\") ? "\\" : "/";
        const metaPath = `${destPath}${sep}${META_FILE}`;
        try {
            const contentBytes = await invoke<number[]>("read_file_content", { path: metaPath });
            const content = new TextDecoder().decode(new Uint8Array(contentBytes));
            const json = JSON.parse(content);
            if (json.requiredPlugins && Array.isArray(json.requiredPlugins)) {
                const missing = pluginLoader.checkMissingRequirements(json.requiredPlugins);
                if (missing.length > 0) {
                     setWarningMsg(`Project saved to ${destPath}, but cannot be opened.\n\nMissing universally required plugins:\n- ${missing.join('\n- ')}\n\nPlease install/enable them and try again.`);
                     return;
                }
            }
        } catch (e) {
            // Ignore
        }

        setRootPath(destPath);
        setFileSystemRefresh(prev => prev + 1);
        setDetectedRemote("");

        const activeFile = currentFilePathRef.current;
        if (activeFile) {
           setCurrentFilePath(null);
           setTimeout(() => setCurrentFilePath(activeFile), 50);
        }

        if (!silent) alert(`Project cloned to ${destPath}`);
      } catch (e: any) {
        setWarningMsg("Failed to save incoming project: " + e.toString());
        throw e; // Rethrow to notify caller
      }
    } else {
      setWarningMsg("Sync cancelled: No destination folder selected.");
      throw new Error("Cancelled by user");
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