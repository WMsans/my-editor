import { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";

const META_FILE = ".collab_meta.json";

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
          // If we are host, clear the hostId in meta file before pushing
          if (isHostRef.current) {
             const sep = currentRoot.includes("\\") ? "\\": "/";
             const metaPath = `${currentRoot}${sep}${META_FILE}`;
             const content = new TextEncoder().encode(JSON.stringify({ hostId: "" }, null, 2));
             try {
                await invoke("write_file_content", { 
                    path: metaPath, 
                    content: Array.from(content)
                });
             } catch (e) {
                console.error("Failed to clear host ID:", e);
             }
          }

          await invoke("push_changes", { path: currentRoot, sshKeyPath: currentSsh || "" });
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