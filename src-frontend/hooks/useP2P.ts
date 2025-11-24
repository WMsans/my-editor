import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import * as Y from "yjs";

export function useP2P(
  sessionId: string | null,
  getDocForKey: (pathKey: string) => Y.Doc,
  onProjectReceived: (data: number[]) => void,
  getFileContent: (path: string) => Promise<string>,
  onFileContentReceived: (pathKey: string, data: number[]) => void,
  onSyncReceived?: (pathKey: string) => void,
  onHostDisconnect?: (hostId: string) => void //
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

  const hasSyncedForPath = useRef(new Set<string>());

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
        if (onHostDisconnect) onHostDisconnect(e.payload); //
      }),
      
      listen<{ path: string, data: number[] }>("p2p-sync", (e) => {
        if (!sessionId) return;
        const [sessionKey, pathKey] = e.payload.path.split("::", 2);
        if (sessionKey !== sessionId) return;

        const targetDoc = getDocForKey(pathKey || "__default__");

        const syncKey = `${sessionKey}::${pathKey || "__default__"}`;
        if (!hasSyncedForPath.current.has(syncKey) && !isHostRef.current) {
          try {
            const fragment = targetDoc.getXmlFragment("default");
            fragment.delete(0, fragment.length);
          } catch (e) {
            console.error("Failed to clear YDoc:", e);
          }
          hasSyncedForPath.current.add(syncKey);
        }

        Y.applyUpdate(targetDoc, new Uint8Array(e.payload.data), "p2p");
        if (onSyncReceived) onSyncReceived(pathKey || "__default__");
      }),
      listen<{ path: string, data: number[] }>("p2p-file-content", (e) => {
        if (!sessionId) return;
        const [sessionKey, pathKey] = e.payload.path.split("::", 2);
        if (sessionKey !== sessionId) return;

        onFileContentReceived(pathKey || "__default__", e.payload.data);
      }),

      listen<{ path: string }>("sync-requested", async (e) => {
        if (!sessionId) return;
        const [sessionKey, pathKey] = e.payload.path.split("::", 2);
        if (sessionKey !== sessionId) return;

        const targetKey = pathKey || "__default__";
        const targetDoc = getDocForKey(targetKey);

        const state = Y.encodeStateAsUpdate(targetDoc);
        invoke("broadcast_update", {
          path: `${sessionId}::${targetKey}`,
          data: Array.from(state)
        }).catch(console.error);

        if (isHostRef.current && targetKey) {
          try {
            const content = await getFileContent(targetKey);
            const data = Array.from(new TextEncoder().encode(content));
            invoke("broadcast_file_content", {
              path: `${sessionId}::${targetKey}`,
              data: data
            });
          } catch (err) {
            console.error(`Could not sync requested file ${targetKey}:`, err);
          }
        }
      })
    ];

    return () => {
      listeners.forEach((l) => l.then((unlisten) => unlisten()));
    };
  }, [sessionId, getDocForKey, onProjectReceived, getFileContent, onFileContentReceived, onSyncReceived, onHostDisconnect]);

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

  const requestSync = async (pathKey: string | null) => {
    if (!sessionId || !pathKey) return;
    try {
      await invoke("request_file_sync", { path: `${sessionId}::${pathKey}` });
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