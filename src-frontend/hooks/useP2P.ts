import { useState, useEffect, useCallback } from "react";
import { p2pService } from "../services";

export function useP2P(
  onProjectReceived: (data: number[]) => void,
  onHostDisconnect?: (hostId: string) => void,
  onFileSync?: (path: string) => void
) {
  const [myPeerId, setMyPeerId] = useState<string | null>(p2pService.getPeerId());
  const [myAddresses, setMyAddresses] = useState<string[]>(p2pService.getAddresses());
  const [incomingRequest, setIncomingRequest] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(p2pService.getIsHost());
  const [status, setStatus] = useState("Initializing...");
  const [connectedPeers, setConnectedPeers] = useState(0);
  const [isJoining, setIsJoining] = useState(false);

  useEffect(() => {
    // Subscribe to Service Events
    const unsubs = [
      p2pService.on('identity-updated', (data: any) => {
        setMyPeerId(data.peerId);
        setMyAddresses(data.addresses);
      }),
      p2pService.on('join-requested', (peerId: string) => {
        setIncomingRequest(peerId);
        setStatus(`Incoming request from ${peerId.slice(0, 8)}...`);
      }),
      p2pService.on('peers-changed', (count: number) => setConnectedPeers(count)),
      p2pService.on('role-changed', (host: boolean) => setIsHost(host)),
      p2pService.on('status-change', (msg: string) => setStatus(msg)),
      p2pService.on('project-received', (data: number[]) => {
          setIsJoining(false); // Clear joining state
          onProjectReceived(data);
      }),
      p2pService.on('host-disconnected', (id: string) => onHostDisconnect && onHostDisconnect(id)),
      p2pService.on('file-synced', (path: string) => onFileSync && onFileSync(path))
    ];

    return () => unsubs.forEach(fn => fn());
  }, [onProjectReceived, onHostDisconnect, onFileSync]);

  const sendJoinRequest = useCallback(async (peerId: string, remoteAddrs: string[] = []) => {
    setIsJoining(true);
    await p2pService.sendJoinRequest(peerId, remoteAddrs);
  }, []);

  const acceptRequest = useCallback(async (currentPath: string) => {
    if (!incomingRequest) return;
    if (!currentPath) {
        setStatus("Cannot accept: No folder opened to share.");
        return;
    }
    try {
      await p2pService.approveJoin(incomingRequest, currentPath);
      setIncomingRequest(null);
      setStatus(`Accepted ${incomingRequest.slice(0, 8)}. Sending folder...`);
    } catch (e) {
      setStatus(`Error accepting: ${e}`);
    }
  }, [incomingRequest]);

  const rejectRequest = useCallback(() => setIncomingRequest(null), []);

  const requestSync = useCallback(async (path: string) => {
    try {
      await p2pService.requestFileSync(path);
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