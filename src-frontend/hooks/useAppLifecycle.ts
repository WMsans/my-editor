import { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";

interface UseAppLifecycleProps {
  rootPathRef: React.MutableRefObject<string>;
  sshKeyPathRef: React.MutableRefObject<string>;
  isHostRef: React.MutableRefObject<boolean>;
  setWarningMsg: (msg: string | null) => void;
  connectedPeersRef: React.MutableRefObject<number>; // Add Ref for peers
}

export function useAppLifecycle({
  rootPathRef,
  sshKeyPathRef,
  isHostRef,
  setWarningMsg,
  connectedPeersRef
}: UseAppLifecycleProps) {
  const [pendingQuit, setPendingQuit] = useState(false);
  const [isPushing, setIsPushing] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    const unlisten = win.onCloseRequested(async (event) => {
      const currentRoot = rootPathRef.current;
      const currentSsh = sshKeyPathRef.current;

      if (currentRoot && !pendingQuit) {
        event.preventDefault(); 
        setIsPushing(true);
        try {
          // If we are host, push changes.
          if (isHostRef.current) {
             // LOGIC FIX:
             // 1. If we are ALONE (connectedPeers == 0), we wipe the hostId.
             //    This ensures the repo is "clean" for the next session.
             // 2. If we have GUESTS (connectedPeers > 0), we DO NOT touch the meta file.
             //    We let the guests detect the disconnect, claim host, and write their own ID.
             //    This prevents the race condition/git conflict where we write "null" 
             //    while they write "newHost".
             if (connectedPeersRef.current === 0) {
                 const sep = currentRoot.includes("\\") ? "\\" : "/";
                 const metaPath = `${currentRoot}${sep}.collab_meta.json`;
                 try {
                     const meta = { hostId: null, hostAddrs: [] };
                     const content = new TextEncoder().encode(JSON.stringify(meta, null, 2));
                     await invoke("write_file_content", { 
                        path: metaPath, 
                        content: Array.from(content) 
                     });
                     console.log("Wiped host ID (Session ended alone).");
                 } catch (e) {
                     console.error("Failed to wipe host ID:", e);
                 }
             } else {
                 console.log("Leaving session with active peers. Skipping meta wipe to allow handover.");
             }

             await invoke("push_changes", { path: currentRoot, sshKeyPath: currentSsh || "" });
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
  }, [pendingQuit]);

  const handleQuit = async () => {
    const win = getCurrentWindow();
    await win.close(); 
  };

  const handleForceQuit = async () => {
    await getCurrentWindow().destroy();
  };

  return {
    pendingQuit,
    setPendingQuit,
    isPushing,
    handleQuit,
    handleForceQuit
  };
}