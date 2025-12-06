import { useState, useEffect } from "react";
import { appLocalDataDir, join } from '@tauri-apps/api/path';
import { Editor } from "@tiptap/react";

import { registry } from "../mod-engine/Registry";
import { createHostAPI } from "../mod-engine/HostAPIImpl";
import { pluginLoader } from "../mod-engine/PluginLoader";
import { useProjectStore } from "../stores/useProjectStore";
import { useUIStore } from "../stores/useUIStore";

export function useAppBootstrap(editorRef: React.MutableRefObject<Editor | null>) {
  const [isAppReady, setIsAppReady] = useState(false);
  const [loadError, setLoadError] = useState<string|null>(null);
  
  const { setCurrentFilePath } = useProjectStore();
  const { setWarningMsg } = useUIStore();

  useEffect(() => {
    let isMounted = true; 
    const initEngine = async () => {
      try {
        if (!isMounted) return;
        
        // 1. Create Host API (Lazy access to editor via ref)
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
        
        // Expose for debugging
        // @ts-ignore
        window.CollabAPI = api;
        
        // 2. Initialize Registry
        registry.init(api);
        
        registry.registerCommand("file.open", (path: string) => {
          if (typeof path === 'string') setCurrentFilePath(path);
        });
        registry.registerCommand("window.reload", () => window.location.reload());

        // 3. Load Plugins
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
    
    return () => { 
        isMounted = false; 
        pluginLoader.deactivateAll(); 
    };
  }, [setCurrentFilePath, setWarningMsg]); 

  return { isAppReady, loadError };
}