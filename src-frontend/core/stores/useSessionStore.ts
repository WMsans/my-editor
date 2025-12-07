import { create } from "zustand";

export type SessionStatus = 'idle' | 'negotiating' | 'syncing' | 'connected' | 'error' | 'offline';

interface SessionState {
  status: SessionStatus;
  statusMessage: string;
  isHost: boolean;
  connectedPeers: number;
  incomingRequest: string | null;
  deadHostId: string | null;
  
  setStatus: (status: SessionStatus, msg?: string) => void;
  setIsHost: (val: boolean) => void;
  setConnectedPeers: (count: number) => void;
  setIncomingRequest: (id: string | null) => void;
  setDeadHostId: (id: string | null) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  status: 'idle',
  statusMessage: "Ready",
  isHost: true,
  connectedPeers: 0,
  incomingRequest: null,
  deadHostId: null,

  setStatus: (status, msg) => set({ status, statusMessage: msg || status }),
  setIsHost: (val) => set({ isHost: val }),
  setConnectedPeers: (count) => set({ connectedPeers: count }),
  setIncomingRequest: (id) => set({ incomingRequest: id }),
  setDeadHostId: (id) => set({ deadHostId: id }),
}));