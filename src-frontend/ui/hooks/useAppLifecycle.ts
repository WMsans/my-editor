import { useState, useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { pluginLoader } from "../../engine/PluginLoader";
import { useProjectStore } from "../../core/stores/useProjectStore";
import { useP2PStore } from "../../core/stores/useP2PStore";
import { useUIStore } from "../../core/stores/useUIStore";

export function useAppLifecycle() {
  const [pendingQuit, setPendingQuit] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const setWarningMsg = useUIStore(s => s.setWarningMsg);
  
  // Use a ref to track the quit status immediately, avoiding stale closures in the event listener
  const pendingQuitRef = useRef(false);

  useEffect(() => {
    const win = getCurrentWindow();
    const unlisten = win.onCloseRequested(async (event) => {
      // Access state directly (snapshot)
      const { rootPath, sshKeyPath } = useProjectStore.getState();
      const { isHost, connectedPeers } = useP2PStore.getState();

      // Check the ref instead of the state variable
      // If pendingQuitRef.current is true, we skip this block and allow the window to close.
      if (rootPath && !pendingQuitRef.current) {
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
             
             const pushPromise = invoke("push_changes", { path: rootPath, sshKeyPath: sshKeyPath || "" });
             const timeoutPromise = new Promise((_, reject) => 
                 setTimeout(() => reject(new Error("Push operation timed out (15s). Network may be slow or down.")), 15000)
             );
             
             await Promise.race([pushPromise, timeoutPromise]);
          }
          
          // Update the ref IMMEDIATELY before calling close()
          pendingQuitRef.current = true;
          setPendingQuit(true);
          
          await win.close();
        } catch (e: any) {
          setIsPushing(false);
          // This will now trigger the WarningModal, allowing the user to "Quit Anyway"
          setWarningMsg(`Failed to push changes before quitting:\n\n${e.toString()}\n\nQuit anyway?`);
        }
      } 
      // If pendingQuitRef is true, we do nothing, allowing the default close event to propagate.
    });
    return () => { unlisten.then(f => f()); };
  }, [setWarningMsg]); // pendingQuit removed from dependencies as we rely on the Ref

  // Regular quit triggers the lifecycle check
  const handleQuit = async () => { const win = getCurrentWindow(); await win.close(); };
  
  // Force quit (from modal) destroys immediately
  const handleForceQuit = async () => { await getCurrentWindow().destroy(); };

  return { pendingQuit, setPendingQuit, isPushing, handleQuit, handleForceQuit };
}