import { create } from "zustand";
import { p2pService } from "../services";

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

// Initialize with service defaults
export const useP2PStore = create<P2PState>((set) => ({
  isHost: p2pService.getIsHost(),
  status: "Initializing...",
  myPeerId: p2pService.getPeerId(),
  connectedPeers: 0,
  incomingRequest: null,
  isJoining: false,
  isSyncing: false,
  myAddresses: p2pService.getAddresses(),
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