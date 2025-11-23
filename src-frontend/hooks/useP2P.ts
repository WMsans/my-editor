// src-frontend/hooks/useP2P.ts
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
  const [peers, setPeers] = useState<string[]>([]);
  const [myPeerId, setMyPeerId] = useState<string | null>(null);
  const [incomingRequest, setIncomingRequest] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(true);
  const [status, setStatus] = useState("Initializing...");
  const [isJoining, setIsJoining] = useState(false);
  
  // [!code ++] Refs to access latest state inside stable listeners
  const ydocRef = useRef(ydoc);
  const pathRef = useRef(currentRelativePath);
  const isHostRef = useRef(isHost);
  const callbacksRef = useRef({ onProjectReceived, getFileContent, onFileContentReceived, onSyncReceived });

  useEffect(() => {
    ydocRef.current = ydoc;
    pathRef.current = currentRelativePath;
    isHostRef.current = isHost;
    callbacksRef.current = { onProjectReceived, getFileContent, onFileContentReceived, onSyncReceived };
  }, [ydoc, currentRelativePath, isHost, onProjectReceived, getFileContent, onFileContentReceived, onSyncReceived]);

  // Track sync state
  const hasSyncedRef = useRef(false);
  useEffect(() => {
    hasSyncedRef.current = false;
  }, [currentRelativePath]);

  useEffect(() => {
    invoke<string[]>("get_peers").then((current) => {
      setPeers((prev) => [...new Set([...prev, ...current])]);
    });
    invoke<string>("get_local_peer_id").then(setMyPeerId).catch(() => {});

    // [!code ++] Persistent listeners (no dependency on ydoc/path)
    const listenersPromise = Promise.all([
      listen<string>("local-peer-id", (e) => setMyPeerId(e.payload)),
      listen<string>("peer-discovered", (e) => setPeers((prev) => [...new Set([...prev, e.payload])])),
      listen<string>("peer-expired", (e) => setPeers((prev) => prev.filter((p) => p !== e.payload))),
      listen<string>("join-requested", (e) => {
        setIncomingRequest(e.payload);
        setStatus(`Incoming request from ${e.payload.slice(0, 8)}...`);
      }),
      listen<number[]>("join-accepted", (e) => {
        callbacksRef.current.onProjectReceived(e.payload);
        setIsHost(false);
        setIsJoining(false);
        setStatus("Joined session! Folder synced.");
      }),
      listen<string>("host-disconnected", (e) => {
        setStatus(`⚠ Host disconnected! Negotiating...`);
        setPeers((prev) => prev.filter((p) => p !== e.payload));
        setIsHost(true); 
      }),
      
      // --- SYNC LISTENERS (using Refs) ---
      
      listen<{ path: string, data: number[] }>("p2p-sync", (e) => {
        const currentPath = pathRef.current;
        const doc = ydocRef.current;
        
        if (currentPath && e.payload.path === currentPath) {
            // New Logic: Use the first sync to overwrite local state
            if (!isHostRef.current && !hasSyncedRef.current) {
                try {
                    const fragment = doc.getXmlFragment("default");
                    fragment.delete(0, fragment.length);
                    hasSyncedRef.current = true;
                } catch (e) {
                    console.error("Failed to clear YDoc:", e);
                }
            }

            Y.applyUpdate(doc, new Uint8Array(e.payload.data), 'p2p');
            if (callbacksRef.current.onSyncReceived) callbacksRef.current.onSyncReceived();
        }
      }),
      listen<{ path: string, data: number[] }>("p2p-file-content", (e) => {
        const currentPath = pathRef.current;
        if (currentPath && e.payload.path === currentPath) {
           callbacksRef.current.onFileContentReceived(e.payload.data);
           hasSyncedRef.current = true;
        }
      }),
      
      listen<{ path: string }>("sync-requested", async (e) => {
        const requestedPath = e.payload.path;
        const currentPath = pathRef.current;
        const doc = ydocRef.current;
        
        // 1. If we have the file open, share the LIVE state.
        if (currentPath && requestedPath === currentPath) {
            const state = Y.encodeStateAsUpdate(doc);
            invoke("broadcast_update", { 
                path: currentPath, 
                data: Array.from(state) 
            }).catch(console.error);
        } else {
            // 2. If not open, Host reads from disk.
            if (isHostRef.current) {
                try {
                    const content = await callbacksRef.current.getFileContent(requestedPath);
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
    ]);

    return () => {
      listenersPromise.then(unlistenFns => unlistenFns.forEach(u => u()));
    };
  }, []); // Empty dependency array = No race condition on file switch

  const sendJoinRequest = async (peerId: string) => {
    try {
      setIsJoining(true);
      setStatus(`Requesting to join ${peerId.slice(0, 8)}...`);
      await invoke("request_join", { peerId });
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
    peers,
    myPeerId,
    incomingRequest,
    isHost,
    isJoining,
    status,
    setStatus,
    sendJoinRequest,
    acceptRequest,
    rejectRequest,
    requestSync 
  };
}