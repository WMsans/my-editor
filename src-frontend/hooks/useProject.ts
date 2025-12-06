import { useRef, useCallback, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog"; 
import { documentRegistry } from "../mod-engine/DocumentRegistry";
import { pluginLoader } from "../mod-engine/PluginLoader";
import { fsService } from "../services";
import { useProjectStore } from "../stores/useProjectStore";
import { useUIStore } from "../stores/useUIStore";

const META_FILE = ".collab_meta.json";

export function useProject() {
  // Select state from stores
  const { 
    rootPath, setRootPath, 
    setCurrentFilePath,
    triggerFileSystemRefresh,
    sshKeyPath,
    setDetectedRemote
  } = useProjectStore();
  
  const setWarningMsg = useUIStore(s => s.setWarningMsg);
  
  // Refs for logic that needs current values without triggering re-renders
  const isAutoJoining = useRef(false);

  // Sync Registry
  useEffect(() => {
    documentRegistry.setRootPath(rootPath);
  }, [rootPath]);

  const getRelativePath = useCallback((file: string | null) => {
    if (!rootPath || !file) return null;
    if (file.startsWith(rootPath)) {
      let rel = file.substring(rootPath.length);
      if (rel.startsWith("/") || rel.startsWith("\\")) rel = rel.substring(1);
      return rel;
    }
    return file; 
  }, [rootPath]);

  const refreshRemoteOrigin = useCallback(async () => {
    if (rootPath) {
        try {
            const remote = await fsService.getRemoteOrigin(rootPath);
            setDetectedRemote(remote);
        } catch {
            setDetectedRemote("");
        }
    }
  }, [rootPath, setDetectedRemote]);

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

        setDetectedRemote("");
        try {
          await fsService.initGitRepo(selected);
          const remote = await fsService.getRemoteOrigin(selected);
          setDetectedRemote(remote);
        } catch (e) {
          console.log("Git status:", e);
        }

        setRootPath(selected);
        triggerFileSystemRefresh();
      }
    } catch (e) {
      setWarningMsg("Folder open error: " + e);
    }
  };

  const handleProjectReceived = useCallback(async (data: number[]) => {
    let destPath: string | null = null;
    let silent = false;

    // We can read the current rootPath from the store via the hook variable
    if (isAutoJoining.current && rootPath) {
        destPath = rootPath;
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
        triggerFileSystemRefresh();
        setDetectedRemote("");
        if (!silent) alert(`Project cloned to ${destPath}`);
      } catch (e: any) {
        setWarningMsg("Save failed: " + e.toString());
        throw e;
      }
    }
  }, [rootPath, setRootPath, setWarningMsg, triggerFileSystemRefresh, setDetectedRemote]);

  return {
    isAutoJoining, // Exposed ref for negotiation hook
    handleOpenFolder,
    handleNewFile: useCallback(() => setCurrentFilePath(null), [setCurrentFilePath]),
    handleProjectReceived,
    getRelativePath,
    refreshRemoteOrigin
  };
}