//
import { useState, useEffect } from "react";
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
  // NEW
  const [myPeerId, setMyPeerId] = useState<string | null>(null);
  const [incomingRequest, setIncomingRequest] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(true);
  const [status, setStatus] = useState("Initializing...");

  useEffect(() => {
    invoke<string[]>("get_peers").then((current) => {
      setPeers((prev) => [...new Set([...prev, ...current])]);
    });
    // NEW
    invoke<string>("get_local_peer_id").then(setMyPeerId).catch(() => {});

    const listeners = [
      listen<string>("local-peer-id", (e) => setMyPeerId(e.payload)), // ADDED
      listen<string>("peer-discovered", (e) => setPeers((prev) => [...new Set([...prev, e.payload])])),
      listen<string>("peer-expired", (e) => setPeers((prev) => prev.filter((p) => p !== e.payload))),
      listen<string>("join-requested", (e) => {
        setIncomingRequest(e.payload);
        setStatus(`Incoming request from ${e.payload.slice(0, 8)}...`);
      }),
      listen<number[]>("join-accepted", (e) => {
        onProjectReceived(e.payload);
        setIsHost(false);
        setStatus("Joined session! Folder synced.");
      }),
      listen<string>("host-disconnected", (e) => {
        // Updated to generic message, logic moved to App.tsx
        setStatus(`⚠ Host disconnected! Negotiating...`);
        setIsHost(true); // Default back to host role until we rejoin or claim
      }),
      // ... existing sync listeners ...
      listen<{ path: string, data: number[] }>("p2p-sync", (e) => {
        if (currentRelativePath && e.payload.path === currentRelativePath) {
            Y.applyUpdate(ydoc, new Uint8Array(e.payload.data));
            if (onSyncReceived) onSyncReceived();
        }
      }),
      listen<{ path: string, data: number[] }>("p2p-file-content", (e) => {
        if (currentRelativePath && e.payload.path === currentRelativePath) {
           onFileContentReceived(e.payload.data);
        }
      }),
      listen<{ path: string }>("sync-requested", async (e) => {
        // ... existing sync logic ...
        const requestedPath = e.payload.path;
        if (currentRelativePath && requestedPath === currentRelativePath) {
            const state = Y.encodeStateAsUpdate(ydoc);
            invoke("broadcast_update", { 
                path: currentRelativePath, 
                data: Array.from(state) 
            }).catch(console.error);
        } else {
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
      })
    ];

    return () => {
      listeners.forEach((l) => l.then((unlisten) => unlisten()));
    };
}, [ydoc, onProjectReceived, currentRelativePath, getFileContent, onFileContentReceived, onSyncReceived]);

  const sendJoinRequest = async (peerId: string) => {
    try {
      setStatus(`Requesting to join ${peerId.slice(0, 8)}...`);
      await invoke("request_join", { peerId });
    } catch (e) {
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
    myPeerId, // Return this
    incomingRequest,
    isHost,
    status,
    setStatus, // Return this setter so App.tsx can update status
    sendJoinRequest,
    acceptRequest,
    rejectRequest,
    requestSync 
  };
}