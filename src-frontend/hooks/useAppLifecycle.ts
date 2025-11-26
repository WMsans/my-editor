import { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";

interface UseAppLifecycleProps {
  rootPathRef: React.MutableRefObject<string>;
  sshKeyPathRef: React.MutableRefObject<string>;
  isHostRef: React.MutableRefObject<boolean>;
  setWarningMsg: (msg: string | null) => void;
}

export function useAppLifecycle({
  rootPathRef,
  sshKeyPathRef,
  isHostRef,
  setWarningMsg
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
          // If we are host, push changes only.
          // We intentionally do NOT clear the hostId in meta file here.
          // Clearing it creates a race condition/conflict with the guest 
          // who is simultaneously writing their own ID to the same file.
          if (isHostRef.current) {
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
    await win.close(); // Triggers the onCloseRequested above
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