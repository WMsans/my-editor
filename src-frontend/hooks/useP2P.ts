import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import * as Y from "yjs";

// Add currentFilePath to arguments
export function useP2P(
  ydoc: Y.Doc, 
  currentFilePath: string | null, 
  onProjectReceived: (data: number[]) => void
) {
  const [peers, setPeers] = useState<string[]>([]);
  const [incomingRequest, setIncomingRequest] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(true);
  const [status, setStatus] = useState("");

  useEffect(() => {
    invoke<string[]>("get_peers").then((current) => {
      setPeers((prev) => [...new Set([...prev, ...current])]);
    });

    const listeners = [
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
        setStatus(`⚠ Host ${e.payload.slice(0, 8)} disconnected!`);
        setIsHost(true);
      }),
      // Listen for structured Sync event
      listen<{ path: string, data: number[] }>("p2p-sync", (e) => {
        // Only apply update if we are looking at the same file
        if (currentFilePath && e.payload.path === currentFilePath) {
            Y.applyUpdate(ydoc, new Uint8Array(e.payload.data));
        }
      })
    ];

    return () => {
      listeners.forEach((l) => l.then((unlisten) => unlisten()));
    };
  }, [ydoc, onProjectReceived, currentFilePath]); // Re-bind when file changes

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

  return {
    peers,
    incomingRequest,
    isHost,
    status,
    sendJoinRequest,
    acceptRequest,
    rejectRequest
  };
}