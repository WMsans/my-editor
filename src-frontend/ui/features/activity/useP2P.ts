import { useCallback } from "react";
import { p2pService } from "../../../core/services";
import { useSessionStore } from "../../../core/stores/useSessionStore";

export function useP2P() {
  const {
    incomingRequest, setIncomingRequest, setStatus
  } = useSessionStore();

  const sendJoinRequest = useCallback(async (peerId: string, remoteAddrs: string[] = []) => {
    // Ideally this goes through sessionService.negotiateHost, but for manual override:
    setStatus('negotiating', `Manually joining ${peerId.slice(0, 8)}...`);
    await p2pService.sendJoinRequest(peerId, remoteAddrs);
  }, [setStatus]);

  const acceptRequest = useCallback(async (currentPath: string) => {
    if (!incomingRequest) return;
    if (!currentPath) {
        setStatus('error', "Cannot accept: No folder opened to share.");
        return;
    }
    try {
      await p2pService.approveJoin(incomingRequest, currentPath);
      setIncomingRequest(null);
      setStatus('connected', `Accepted ${incomingRequest.slice(0, 8)}. Sending folder...`);
    } catch (e) {
      setStatus('error', `Error accepting: ${e}`);
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