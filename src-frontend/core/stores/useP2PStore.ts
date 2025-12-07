import { create } from "zustand";

interface P2PState {
  isHost: boolean;
  status: string;
  myPeerId: string | null;
  connectedPeers: number;
  incomingRequest: string | null;
  isJoining: boolean;
  isSyncing: boolean;
  myAddresses: string[];
  deadHostId: string | null;

  setIsHost: (val: boolean) => void;
  setStatus: (msg: string) => void;
  setMyPeerId: (id: string | null) => void;
  setConnectedPeers: (count: number) => void;
  setIncomingRequest: (id: string | null) => void;
  setIsJoining: (val: boolean) => void;
  setIsSyncing: (val: boolean) => void;
  setMyAddresses: (addrs: string[]) => void;
  setDeadHostId: (id: string | null) => void;
}

export const useP2PStore = create<P2PState>((set) => ({
  isHost: true, // Default safe state
  status: "Initializing...",
  myPeerId: null,
  connectedPeers: 0,
  incomingRequest: null,
  isJoining: false,
  isSyncing: false,
  myAddresses: [],
  deadHostId: null,

  setIsHost: (val) => set({ isHost: val }),
  setStatus: (msg) => set({ status: msg }),
  setMyPeerId: (id) => set({ myPeerId: id }),
  setConnectedPeers: (count) => set({ connectedPeers: count }),
  setIncomingRequest: (id) => set({ incomingRequest: id }),
  setIsJoining: (val) => set({ isJoining: val }),
  setIsSyncing: (val) => set({ isSyncing: val }),
  setMyAddresses: (addrs) => set({ myAddresses: addrs }),
  setDeadHostId: (id) => set({ deadHostId: id }),
}));