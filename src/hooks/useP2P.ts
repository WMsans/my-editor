import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import * as Y from "yjs";

export function useP2P(ydoc: Y.Doc) {
  const [peers, setPeers] = useState<string[]>([]);
  const [incomingRequest, setIncomingRequest] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(true);
  const [status, setStatus] = useState("");

  useEffect(() => {
    // Initial fetch
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
        Y.applyUpdate(ydoc, new Uint8Array(e.payload));
        setIsHost(false);
        setStatus("Joined session! Editing shared doc.");
      }),
      listen<string>("host-disconnected", (e) => {
        setStatus(`⚠ Host ${e.payload.slice(0, 8)} disconnected!`);
        setIsHost(true);
      }),
      listen<number[]>("p2p-sync", (e) => {
        Y.applyUpdate(ydoc, new Uint8Array(e.payload));
      })
    ];

    return () => {
      listeners.forEach((l) => l.then((unlisten) => unlisten()));
    };
  }, [ydoc]);

  const sendJoinRequest = async (peerId: string) => {
    try {
      setStatus(`Requesting to join ${peerId.slice(0, 8)}...`);
      await invoke("request_join", { peerId });
    } catch (e) {
      setStatus(`Error joining: ${e}`);
    }
  };

  const acceptRequest = async () => {
    if (!incomingRequest) return;
    try {
      const stateVector = Y.encodeStateAsUpdate(ydoc);
      await invoke("approve_join", {
        peerId: incomingRequest,
        content: Array.from(stateVector),
      });
      setIncomingRequest(null);
      setStatus(`Accepted ${incomingRequest.slice(0, 8)}`);
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