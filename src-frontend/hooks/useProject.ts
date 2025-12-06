import { useState, useEffect, useRef, useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog"; 
import { documentRegistry } from "../mod-engine/DocumentRegistry";
import { pluginLoader } from "../mod-engine/PluginLoader";
import { fsService, authService } from "../services";

const META_FILE = ".collab_meta.json";

export function useProject(setWarningMsg: (msg: string | null) => void) {
  const [rootPath, setRootPath] = useState<string>("");
  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null);
  const [fileSystemRefresh, setFileSystemRefresh] = useState(0);
  const [sshKeyPath, setSshKeyPath] = useState(localStorage.getItem("sshKeyPath") || "");
  const [detectedRemote, setDetectedRemote] = useState("");

  const rootPathRef = useRef(rootPath);
  const sshKeyPathRef = useRef(sshKeyPath);
  const currentFilePathRef = useRef(currentFilePath);
  const isAutoJoining = useRef(false);

  useEffect(() => {
    rootPathRef.current = rootPath;
    documentRegistry.setRootPath(rootPath);
  }, [rootPath]);

  useEffect(() => {
    sshKeyPathRef.current = sshKeyPath;
    localStorage.setItem("sshKeyPath", sshKeyPath);
  }, [sshKeyPath]);

  useEffect(() => { currentFilePathRef.current = currentFilePath; }, [currentFilePath]);

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

  const refreshRemoteOrigin = useCallback(async () => {
    if (rootPath) {
        try {
            const remote = await fsService.getRemoteOrigin(rootPath);
            setDetectedRemote(remote);
        } catch {
            setDetectedRemote("");
        }
    }
  }, [rootPath]);

  const handleOpenFolder = async () => {
    if (rootPath) {
      try { 
        await fsService.pushChanges(rootPath, sshKeyPath || ""); 
      } catch (e) { 
        console.error("Push failed for prev folder:", e);
      }
    }

    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Open Project Folder"
      });

      if (selected && typeof selected === 'string') {
        // Plugin Requirement Check
        try {
            const content = await fsService.readFileString(`${selected}/${META_FILE}`);
            const json = JSON.parse(content);
            if (json.requiredPlugins) {
                const missing = pluginLoader.checkMissingRequirements(json.requiredPlugins);
                if (missing.length > 0) {
                     setWarningMsg(`Cannot open project.\nMissing plugins:\n- ${missing.join('\n- ')}`);
                     return;
                }
            }
        } catch (e) { /* Ignore */ }

        setRootPath(selected);
        setFileSystemRefresh(prev => prev + 1);
        setDetectedRemote("");
        try {
          await fsService.initGitRepo(selected);
          const remote = await fsService.getRemoteOrigin(selected);
          setDetectedRemote(remote);
        } catch (e) {
          console.log("Git status:", e);
        }
      }
    } catch (e) {
      setWarningMsg("Folder open error: " + e);
    }
  };

  const handleProjectReceived = useCallback(async (data: number[]) => {
    let destPath: string | null = null;
    let silent = false;

    if (isAutoJoining.current && rootPathRef.current) {
        destPath = rootPathRef.current;
        silent = true; 
        isAutoJoining.current = false; 
    } else {
        const selected = await open({
            directory: true,
            multiple: false,
            title: "Select Destination"
        });
        if (selected && typeof selected === 'string') destPath = selected;
    }

    if (destPath) {
      try {
        await fsService.saveIncomingProject(destPath, data);

        // Validation
        try {
            const content = await fsService.readFileString(`${destPath}/${META_FILE}`);
            const json = JSON.parse(content);
            if (json.requiredPlugins) {
                const missing = pluginLoader.checkMissingRequirements(json.requiredPlugins);
                if (missing.length > 0) {
                     setWarningMsg(`Project saved but cannot open.\nMissing plugins:\n- ${missing.join('\n- ')}`);
                     return;
                }
            }
        } catch (e) { /* Ignore */ }

        setRootPath(destPath);
        setFileSystemRefresh(prev => prev + 1);
        setDetectedRemote("");
        if (!silent) alert(`Project cloned to ${destPath}`);
      } catch (e: any) {
        setWarningMsg("Save failed: " + e.toString());
        throw e;
      }
    }
  }, [setWarningMsg]);

  return {
    rootPath, rootPathRef,
    currentFilePath, setCurrentFilePath, currentFilePathRef,
    fileSystemRefresh, setFileSystemRefresh,
    sshKeyPath, setSshKeyPath, sshKeyPathRef,
    detectedRemote, refreshRemoteOrigin,
    isAutoJoining,
    handleOpenFolder,
    handleNewFile: useCallback(() => setCurrentFilePath(null), []),
    handleProjectReceived,
    getRelativePath
  };
}