import { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { pluginLoader } from "../mod-engine/PluginLoader";
import { useProjectStore } from "../stores/useProjectStore";
import { useP2PStore } from "../stores/useP2PStore";
import { useUIStore } from "../stores/useUIStore";

export function useAppLifecycle() {
  const [pendingQuit, setPendingQuit] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const setWarningMsg = useUIStore(s => s.setWarningMsg);

  useEffect(() => {
    const win = getCurrentWindow();
    const unlisten = win.onCloseRequested(async (event) => {
      // Access state directly (snapshot)
      const { rootPath, sshKeyPath } = useProjectStore.getState();
      const { isHost, connectedPeers } = useP2PStore.getState();

      if (rootPath && !pendingQuit) {
        event.preventDefault(); 
        setIsPushing(true);
        try {
          if (isHost) {
             if (connectedPeers === 0) {
                 const sep = rootPath.includes("\\") ? "\\" : "/";
                 const metaPath = `${rootPath}${sep}.collab_meta.json`;
                 try {
                     let existingMeta: any = {};
                     try {
                        const existingBytes = await invoke<number[]>("read_file_content", { path: metaPath });
                        const existingStr = new TextDecoder().decode(new Uint8Array(existingBytes));
                        existingMeta = JSON.parse(existingStr);
                     } catch(e) { console.log("Meta read error", e); }

                     const meta = { 
                        hostId: null, 
                        hostAddrs: [],
                        encrypted: existingMeta.encrypted || false,
                        securityCheck: existingMeta.securityCheck || "",
                        requiredPlugins: pluginLoader.getEnabledUniversalPlugins()
                     };

                     const content = new TextEncoder().encode(JSON.stringify(meta, null, 2));
                     await invoke("write_file_content", { 
                        path: metaPath, 
                        content: Array.from(content) 
                     });
                     console.log("Wiped host ID.");
                 } catch (e) {
                     console.error("Failed to wipe host ID:", e);
                 }
             }
             await invoke("push_changes", { path: rootPath, sshKeyPath: sshKeyPath || "" });
          }
          await win.destroy();
        } catch (e: any) {
          setIsPushing(false);
          setWarningMsg(`Failed to push changes before quitting:\n\n${e}\n\nQuit anyway?`);
          setPendingQuit(true);
        }
      } else if (pendingQuit) {
         event.preventDefault();
      }
    });
    return () => { unlisten.then(f => f()); };
  }, [pendingQuit, setWarningMsg]);

  const handleQuit = async () => { const win = getCurrentWindow(); await win.close(); };
  const handleForceQuit = async () => { await getCurrentWindow().destroy(); };

  return { pendingQuit, setPendingQuit, isPushing, handleQuit, handleForceQuit };
}