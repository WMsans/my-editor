import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import * as Y from "yjs";

export function useP2P(
  ydoc: Y.Doc, 
  currentRelativePath: string | null, 
  onProjectReceived: (data: number[]) => void,
  getFileContent: (path: string) => Promise<string>,
  onFileContentReceived: (data: number[]) => void,
  onSyncReceived?: () => void
) {
  const [myPeerId, setMyPeerId] = useState<string | null>(null);
  const [incomingRequest, setIncomingRequest] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(true);
  const [status, setStatus] = useState("Initializing...");
  const [isJoining, setIsJoining] = useState(false);
  const [myAddresses, setMyAddresses] = useState<string[]>([]); 

  const isHostRef = useRef(isHost);
  useEffect(() => {
    isHostRef.current = isHost;
  }, [isHost]);

  const hasSyncedRef = useRef(false);
  useEffect(() => {
    hasSyncedRef.current = false;
  }, [currentRelativePath]);

  useEffect(() => {
    invoke<string>("get_local_peer_id").then(setMyPeerId).catch(() => {});
    
    // ADD THIS: Fetch addresses that might have been emitted before we loaded
    invoke<string[]>("get_local_addrs").then((addrs) => {
        setMyAddresses(prev => {
            const unique = new Set([...prev, ...addrs]);
            return Array.from(unique);
        });
    }).catch(console.error);

    const listeners = [
      listen<string>("local-peer-id", (e) => setMyPeerId(e.payload)),
      listen<string>("new-listen-addr", (e) => {
         setMyAddresses(prev => {
             if (prev.includes(e.payload)) return prev;
             return [...prev, e.payload];
         });
      }),
      listen<string>("join-requested", (e) => {
        setIncomingRequest(e.payload);
        setStatus(`Incoming request from ${e.payload.slice(0, 8)}...`);
      }),
      listen<number[]>("join-accepted", (e) => {
        onProjectReceived(e.payload);
        setIsHost(false);
        setIsJoining(false);
        setStatus("Joined session! Folder synced.");
      }),
      listen<string>("host-disconnected", (e) => {
        setStatus(`⚠ Host disconnected! Negotiating...`);
        setIsHost(true); 
      }),
      
      listen<{ path: string, data: number[] }>("p2p-sync", (e) => {
        if (currentRelativePath && e.payload.path === currentRelativePath) {
            if (!isHostRef.current && !hasSyncedRef.current) {
                try {
                    const fragment = ydoc.getXmlFragment("default");
                    fragment.delete(0, fragment.length);
                    hasSyncedRef.current = true;
                } catch (e) {
                    console.error("Failed to clear YDoc:", e);
                }
            }
            Y.applyUpdate(ydoc, new Uint8Array(e.payload.data), 'p2p');
            if (onSyncReceived) onSyncReceived();
        }
      }),
      listen<{ path: string, data: number[] }>("p2p-file-content", (e) => {
        if (currentRelativePath && e.payload.path === currentRelativePath) {
           onFileContentReceived(e.payload.data);
           hasSyncedRef.current = true;
        }
      }),
      
      listen<{ path: string }>("sync-requested", async (e) => {
        const requestedPath = e.payload.path;
        if (currentRelativePath && requestedPath === currentRelativePath) {
            const state = Y.encodeStateAsUpdate(ydoc);
            invoke("broadcast_update", { 
                path: currentRelativePath, 
                data: Array.from(state) 
            }).catch(console.error);
        } else {
            if (isHostRef.current) {
                try {
                    const content = await getFileContent(requestedPath);
                    const data = Array.from(new TextEncoder().encode(content));
                    invoke("broadcast_file_content", {
                        path: requestedPath,
                        data: data
                    });
                } catch (err) {
                    console.error(`Could not sync requested file ${requestedPath}:`, err);
                }
            }
        }
      })
    ];

    return () => {
      listeners.forEach((l) => l.then((unlisten) => unlisten()));
    };
  }, [ydoc, onProjectReceived, currentRelativePath, getFileContent, onFileContentReceived, onSyncReceived]);

  // CHANGED: Accept array of addresses
  const sendJoinRequest = async (peerId: string, remoteAddrs: string[] = []) => {
    try {
      setIsJoining(true);
      setStatus(`Requesting to join ${peerId.slice(0, 8)}...`);
      // Use new param name
      await invoke("request_join", { peerId, remoteAddrs });
    } catch (e) {
      setIsJoining(false);
      setStatus(`Error joining: ${e}`);
    }
  };

  const acceptRequest = async (currentPath: string) => {
    if (!incomingRequest) return;
    if (!currentPath) {
        setStatus("Cannot accept: No folder opened to share.");
        return;
    }
    try {
      await invoke("approve_join", {
        peerId: incomingRequest,
        projectPath: currentPath
      });
      setIncomingRequest(null);
      setStatus(`Accepted ${incomingRequest.slice(0, 8)}. Sending folder...`);
    } catch (e) {
      setStatus(`Error accepting: ${e}`);
    }
  };

  const rejectRequest = () => setIncomingRequest(null);

  const requestSync = async (path: string) => {
    try {
      await invoke("request_file_sync", { path });
    } catch (e) {
      console.error("Failed to request sync", e);
    }
  };

  return {
    myPeerId,
    incomingRequest,
    isHost,
    isJoining,
    status,
    setStatus,
    sendJoinRequest,
    acceptRequest,
    rejectRequest,
    requestSync,
    myAddresses 
  };
}