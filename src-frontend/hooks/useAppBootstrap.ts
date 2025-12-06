import { useState, useEffect } from "react";
import { appLocalDataDir, join } from '@tauri-apps/api/path';
import { Editor } from "@tiptap/react";

import { registry } from "../mod-engine/Registry";
import { commandService } from "../mod-engine/services/CommandService";
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
        
        // 1. Create Host API
        const api = createHostAPI(
          () => editorRef.current, 
          () => useProjectStore.getState().rootPath,
          setWarningMsg,
          {
            getAll: async () => pluginLoader.getAllManifests(),
            isEnabled: (id: string) => pluginLoader.isPluginEnabled(id),
            setEnabled: (id: string, val: boolean) => pluginLoader.setPluginEnabled(id, val)
          }
        );
        
        // 2. Initialize Registry (Data) & CommandService (Logic)
        registry.init();

        // 3. Register Core Commands
        commandService.registerCommand("file.open", (path: string) => {
          if (typeof path === 'string') setCurrentFilePath(path);
        });
        commandService.registerCommand("window.reload", () => window.location.reload());

        // 4. Load Plugins
        const appDataPath = await appLocalDataDir();
        const pluginsDir = await join(appDataPath, 'plugins');
        
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