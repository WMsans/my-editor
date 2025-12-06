import { create } from "zustand";

interface UIState {
  activeSidebarTab: string;
  isSettingsOpen: boolean;
  warningMsg: string | null;
  passwordRequest: {
    message: string;
    resolve: (val: string | null) => void;
  } | null;

  setActiveSidebarTab: (tab: string) => void;
  setShowSettings: (show: boolean) => void;
  setWarningMsg: (msg: string | null) => void;
  requestPassword: (message: string) => Promise<string | null>;
  resolvePasswordRequest: (val: string | null) => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  activeSidebarTab: "files",
  isSettingsOpen: false,
  warningMsg: null,
  passwordRequest: null,

  setActiveSidebarTab: (tab) => set({ activeSidebarTab: tab }),
  setShowSettings: (show) => set({ isSettingsOpen: show }),
  setWarningMsg: (msg) => set({ warningMsg: msg }),
  
  requestPassword: (message) => {
    return new Promise((resolve) => {
      set({ passwordRequest: { message, resolve } });
    });
  },
  resolvePasswordRequest: (val) => {
    const req = get().passwordRequest;
    if (req) {
      req.resolve(val);
      set({ passwordRequest: null });
    }
  }
}));