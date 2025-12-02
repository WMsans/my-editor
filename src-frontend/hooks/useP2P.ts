import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import * as Y from "yjs";
import { documentRegistry } from "../mod-engine/DocumentRegistry";

export function useP2P(
  onProjectReceived: (data: number[]) => void,
  onHostDisconnect?: (hostId: string) => void,
  onFileSync?: (path: string) => void
) {
  const [myPeerId, setMyPeerId] = useState<string | null>(null);
  const [incomingRequest, setIncomingRequest] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(true);
  const [status, setStatus] = useState("Initializing...");
  const [isJoining, setIsJoining] = useState(false);
  const [myAddresses, setMyAddresses] = useState<string[]>([]);
  
  // Track connected peers to determine if we are alone
  const [connectedPeers, setConnectedPeers] = useState(0);

  const isHostRef = useRef(isHost);
  useEffect(() => {
    isHostRef.current = isHost;
  }, [isHost]);

  // [FIX] Add isJoiningRef to safely check joining state inside event listeners
  const isJoiningRef = useRef(isJoining);
  useEffect(() => {
    isJoiningRef.current = isJoining;
  }, [isJoining]);

  useEffect(() => {
    invoke<string>("get_local_peer_id").then(setMyPeerId).catch(() => {});
    
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
      // --- Peer Tracking Listeners ---
      listen("peer-connected", () => {
        setConnectedPeers(n => n + 1);
      }),
      listen("peer-disconnected", () => {
        setConnectedPeers(n => Math.max(0, n - 1));
      }),
      // -------------------------------
      listen<string>("join-requested", (e) => {
        setIncomingRequest(e.payload);
        setStatus(`Incoming request from ${e.payload.slice(0, 8)}...`);
      }),
      // [CHANGED] Safer join-accepted handler
      listen<number[]>("join-accepted", async (e) => {
        try {
            // Force guest state immediately
            setIsHost(false);
            
            // Handle file saving (this might block or take time)
            await onProjectReceived(e.payload);
            
            setStatus("Joined session! Folder synced.");
        } catch (err) {
            console.error("Error receiving project:", err);
            setStatus("Error syncing project folder.");
        } finally {
            // Ensure we exit joining state even if save fails
            setIsJoining(false);
            setIsHost(false); // Double check
        }
      }),
      listen<string>("host-disconnected", (e) => {
        setStatus(`⚠ Host disconnected! Negotiating...`);
        setIsHost(true);
        if (onHostDisconnect) onHostDisconnect(e.payload);
      }),
      
      listen<{ path: string, data: number[] }>("p2p-sync", (e) => {
        // [FIX] Implicit Join Recovery
        // If we receive sync data from the host, the connection is alive.
        // If we were stuck in 'Requesting to join...', break out immediately.
        if (isJoiningRef.current) {
            console.log("Implicitly joined via sync packet.");
            setIsJoining(false);
            setIsHost(false);
            setStatus("Joined session (Synced).");
        }

        documentRegistry.applyUpdate(e.payload.path, new Uint8Array(e.payload.data));
        if (onFileSync) onFileSync(e.payload.path);
      }),
      
      listen<{ path: string }>("sync-requested", async (e) => {
        const requestedPath = e.payload.path;
        const doc = documentRegistry.getOrCreateDoc(requestedPath);
        const state = Y.encodeStateAsUpdate(doc);
        invoke("broadcast_update", { 
            path: requestedPath, 
            data: Array.from(state) 
        }).catch(console.error);
      })
    ];

    return () => {
      listeners.forEach((l) => l.then((unlisten) => unlisten()));
    };
  }, [onProjectReceived, onHostDisconnect, onFileSync]);

  // WRAPPED IN CALLBACK TO PREVENT INFINITE LOOPS
  const sendJoinRequest = useCallback(async (peerId: string, remoteAddrs: string[] = []) => {
    try {
      setIsJoining(true);
      setStatus(`Requesting to join ${peerId.slice(0, 8)}...`);
      await invoke("request_join", { peerId, remoteAddrs });
    } catch (e) {
      setIsJoining(false);
      setStatus(`Error joining: ${e}`);
    }
  }, []);

  const acceptRequest = useCallback(async (currentPath: string) => {
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
  }, [incomingRequest]);

  const rejectRequest = useCallback(() => setIncomingRequest(null), []);

  const requestSync = useCallback(async (path: string) => {
    try {
      await invoke("request_file_sync", { path });
    } catch (e) {
      console.error("Failed to request sync", e);
    }
  }, []);

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
    myAddresses,
    connectedPeers
  };
}