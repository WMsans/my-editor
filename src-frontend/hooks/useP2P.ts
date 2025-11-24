import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import * as Y from "yjs";

export function useP2P(
  getDoc: (path: string) => Promise<Y.Doc>, 
  currentRelativePath: string | null, 
  onProjectReceived: (data: number[]) => void,
  onSyncReceived?: () => void,
  onHostDisconnect?: (hostId: string) => void
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
        if (onHostDisconnect) onHostDisconnect(e.payload);
      }),
      
      // Global Sync Handler
      listen<{ path: string, data: number[] }>("p2p-sync", async (e) => {
        try {
            // Get or create doc for ANY path
            const doc = await getDoc(e.payload.path);
            
            // Apply update
            Y.applyUpdate(doc, new Uint8Array(e.payload.data), 'p2p');
            
            // If it happens to be the current file, trigger the callback to update UI loading state
            if (currentRelativePath && e.payload.path === currentRelativePath) {
                if (onSyncReceived) onSyncReceived();
            }
        } catch (err) {
            console.error("Failed to apply global p2p sync:", err);
        }
      }),
      
      // Handle file content requests (Full Sync)
      listen<{ path: string }>("sync-requested", async (e) => {
        const requestedPath = e.payload.path;
        
        try {
            // Get the current state of the requested doc
            const doc = await getDoc(requestedPath);
            const state = Y.encodeStateAsUpdate(doc);
            
            invoke("broadcast_update", { 
                path: requestedPath, 
                data: Array.from(state) 
            }).catch(console.error);
        } catch (err) {
            console.error(`Could not sync requested file ${requestedPath}:`, err);
        }
      })
    ];

    return () => {
      listeners.forEach((l) => l.then((unlisten) => unlisten()));
    };
  }, [getDoc, onProjectReceived, currentRelativePath, onSyncReceived, onHostDisconnect]);

  const sendJoinRequest = async (peerId: string, remoteAddrs: string[] = []) => {
    try {
      setIsJoining(true);
      setStatus(`Requesting to join ${peerId.slice(0, 8)}...`);
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