import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

const META_FILE = ".collab_meta.json";

interface UseHostNegotiationProps {
  rootPath: string;
  myPeerId: string | null;
  myAddresses: string[];
  sshKeyPathRef: React.MutableRefObject<string>;
  isHost: boolean;
  deadHostIdRef: React.MutableRefObject<string | null>;
  isAutoJoiningRef: React.MutableRefObject<boolean>;
  sendJoinRequest: (peerId: string, addrs: string[]) => void;
  setStatus: (status: string) => void;
  setWarningMsg: (msg: string | null) => void;
}

export function useHostNegotiation({
  rootPath,
  myPeerId,
  myAddresses,
  sshKeyPathRef,
  isHost,
  deadHostIdRef,
  isAutoJoiningRef,
  sendJoinRequest,
  setStatus,
  setWarningMsg
}: UseHostNegotiationProps) {

  const negotiateHost = async (retryCount = 0) => {
    if (!rootPath || !myPeerId) return;
    
    setStatus(retryCount > 0 ? `Negotiating (Attempt ${retryCount + 1})...` : "Negotiating host...");
    
    const sep = rootPath.includes("\\") ? "\\": "/";
    const metaPath = `${rootPath}${sep}${META_FILE}`;
    const ssh = sshKeyPathRef.current || "";

    try {
        try {
            await invoke("git_pull", { path: rootPath, sshKeyPath: ssh });
        } catch (e) {
            console.log("Git pull skipped/failed (expected if new repo):", e);
        }
        
        let metaHost = "";
        let metaAddrs: string[] = [];
        try {
            const contentBytes = await invoke<number[]>("read_file_content", { path: metaPath });
            const content = new TextDecoder().decode(new Uint8Array(contentBytes));
            const json = JSON.parse(content);
            metaHost = json.hostId;
            metaAddrs = json.hostAddrs || [];
        } catch (e) {
            console.log("Meta file missing or invalid.");
        }

        if (metaHost && metaHost !== myPeerId) {
            // If the meta points to the dead host, ignore it and claim host.
            if (deadHostIdRef.current && metaHost === deadHostIdRef.current) {
                console.log("Ignoring disconnected host ID in meta file.");
            } else {
                if (!isHost) return;

                setStatus(`Found host ${metaHost.slice(0,8)}. Joining...`);
                isAutoJoiningRef.current = true; 
                sendJoinRequest(metaHost, metaAddrs || []);
                return; 
            }
        }

        if (metaHost === myPeerId) {
             const sortedSaved = [...metaAddrs || []].sort();
             const sortedCurrent = [...myAddresses].sort();
             
             if (JSON.stringify(sortedSaved) === JSON.stringify(sortedCurrent)) {
                 setStatus("I am the host (verified).");
                 return; 
             }
             setStatus("Updating host addresses...");
        }

        const content = new TextEncoder().encode(JSON.stringify({ hostId: myPeerId, hostAddrs: myAddresses }, null, 2));
        await invoke("write_file_content", { 
            path: metaPath, 
            content: Array.from(content)
        });

        try {
            await invoke("push_changes", { path: rootPath, sshKeyPath: ssh });
            setStatus("Host claimed and synced.");
            deadHostIdRef.current = null;
        } catch (e) {
            console.error("Push failed:", e);
            if (retryCount < 2) {
                setStatus(`Push failed. Retrying... (${retryCount + 1}/2)`);
                setTimeout(() => negotiateHost(retryCount + 1), 2000);
            } else {
                setWarningMsg("Could not sync host status to remote.\n\nRunning in offline/local host mode.");
                setStatus("Host (Offline/Local)");
            }
        }

    } catch (e) {
        console.error("Negotiation fatal error:", e);
    }
  };

  const prevIsHost = useRef(isHost);

  // Trigger negotiation when rootPath changes or we become the host
  useEffect(() => {
    if (rootPath && myPeerId) {
       negotiateHost();
    }
  }, [rootPath, myPeerId, myAddresses]); 

  // Trigger negotiation if we switch roles to Host
  useEffect(() => {
    if (!prevIsHost.current && isHost && rootPath) {
        negotiateHost();
    }
    prevIsHost.current = isHost;
  }, [isHost, rootPath]);

  return { negotiateHost };
}