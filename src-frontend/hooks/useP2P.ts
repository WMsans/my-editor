import { useEffect, useCallback } from "react";
import { p2pService } from "../services";
import { useP2PStore } from "../stores/useP2PStore";
import { workspaceManager } from "../services";

export function useP2P(
  onProjectReceived: (data: number[]) => void,
  onFileSync?: (path: string) => void
) {
  const {
    setIsHost, setStatus, setMyPeerId, setMyAddresses,
    setIncomingRequest, setConnectedPeers, setIsJoining,
    incomingRequest, setDeadHostId, isHost
  } = useP2PStore();

  useEffect(() => {
    const currentPeerId = p2pService.getPeerId();
    if (currentPeerId) setMyPeerId(currentPeerId);
    
    const currentAddrs = p2pService.getAddresses();
    if (currentAddrs.length > 0) setMyAddresses(currentAddrs);

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
          setIsJoining(false); 
          onProjectReceived(data);
      }),
      p2pService.on('host-disconnected', (id: string) => setDeadHostId(id)),
      p2pService.on('file-synced', (path: string) => onFileSync && onFileSync(path))
    ];

    return () => unsubs.forEach(fn => fn());
  }, [onProjectReceived, onFileSync, setMyPeerId, setMyAddresses, setIncomingRequest, setStatus, setConnectedPeers, setIsHost, setIsJoining, setDeadHostId]);

  useEffect(() => {
    workspaceManager.setIsHost(isHost);
  }, [isHost]);

  const sendJoinRequest = useCallback(async (peerId: string, remoteAddrs: string[] = []) => {
    setIsJoining(true);
    await p2pService.sendJoinRequest(peerId, remoteAddrs);
  }, [setIsJoining]);

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
  }, [incomingRequest, setIncomingRequest, setStatus]);

  const rejectRequest = useCallback(() => setIncomingRequest(null), [setIncomingRequest]);

  const requestSync = useCallback(async (path: string) => {
    try {
      await p2pService.requestFileSync(path);
    } catch (e) {
      console.error("Failed to request sync", e);
    }
  }, []);

  return {
    sendJoinRequest,
    acceptRequest,
    rejectRequest,
    requestSync
  };
}