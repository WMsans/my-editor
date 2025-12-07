import { create } from "zustand";

interface ProjectState {
  rootPath: string;
  currentFilePath: string | null;
  fileSystemRefresh: number;
  sshKeyPath: string;
  encryptionKey: string;
  detectedRemote: string;

  setRootPath: (path: string) => void;
  setCurrentFilePath: (path: string | null) => void;
  triggerFileSystemRefresh: () => void;
  setSshKeyPath: (path: string) => void;
  setEncryptionKey: (key: string) => void;
  setDetectedRemote: (remote: string) => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  rootPath: "",
  currentFilePath: null,
  fileSystemRefresh: 0,
  sshKeyPath: localStorage.getItem("sshKeyPath") || "",
  encryptionKey: localStorage.getItem("encryptionKey") || "",
  detectedRemote: "",

  setRootPath: (path) => set({ rootPath: path }),
  setCurrentFilePath: (path) => set({ currentFilePath: path }),
  triggerFileSystemRefresh: () => set((state) => ({ fileSystemRefresh: state.fileSystemRefresh + 1 })),
  setSshKeyPath: (path) => {
    localStorage.setItem("sshKeyPath", path);
    set({ sshKeyPath: path });
  },
  setEncryptionKey: (key) => {
    localStorage.setItem("encryptionKey", key);
    set({ encryptionKey: key });
  },
  setDetectedRemote: (remote) => set({ detectedRemote: remote }),
}));