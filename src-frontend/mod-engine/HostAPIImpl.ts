import { HostAPI, PluginManifest } from "./types";
import { Editor } from "@tiptap/react";
import { registry } from "./Registry";
import { invoke } from "@tauri-apps/api/core";
import * as Y from "yjs";

// [NEW] Define interface for injected plugin manager
interface PluginManager {
  getAll: () => Promise<PluginManifest[]>;
  isEnabled: (id: string) => boolean;
  setEnabled: (id: string, enabled: boolean) => void;
}

export const createHostAPI = (
  getEditor: () => Editor | null,
  setWarningMsg: (msg: string) => void,
  // [NEW] Inject plugin manager to avoid circular dependency
  pluginManager?: PluginManager 
): HostAPI => {
  return {
    editor: {
      getSafeInstance: () => getEditor(),
      getCommands: () => getEditor()?.commands || null,
      getState: () => getEditor()?.state || null,
      registerExtension: (ext, options) => {
        const priority = options?.priority || 'normal';
        registry.registerExtension(ext, priority);
        console.log(`Extension registered (Priority: ${priority})`);
      }
    },
    ui: {
      registerSidebarTab: (tab) => {
        registry.registerSidebarTab(tab);
      },
      showNotification: (msg) => {
        setWarningMsg(msg);
      }
    },
    commands: {
      registerCommand: (id, handler) => {
        registry.registerCommand(id, handler);
      },
      executeCommand: (id, args) => {
        registry.executeCommand(id, args);
      }
    },
    data: {
      getDoc: () => {
        const editor = getEditor();
        return (editor?.storage?.collaboration as any)?.doc || new Y.Doc();
      },
      getMap: (name: string) => {
        const editor = getEditor();
        const doc = (editor?.storage?.collaboration as any)?.doc;
        if (doc) return doc.getMap(name);
        return new Y.Doc().getMap(name); 
      },
      fs: {
        readFile: async (path: string) => {
          return await invoke<number[]>("read_file_content", { path });
        },
        writeFile: async (path: string, content: number[]) => {
          return await invoke("write_file_content", { path, content });
        }
      }
    },
    // [NEW] Plugin Management
    plugins: {
        getAll: async () => pluginManager ? pluginManager.getAll() : [],
        isEnabled: (id) => pluginManager ? pluginManager.isEnabled(id) : true,
        setEnabled: (id, val) => pluginManager?.setEnabled(id, val)
    }
  };
};

export const createScopedAPI = (baseApi: HostAPI, pluginId: string, permissions: string[] = []): HostAPI => {
  const hasPermission = (perm: string) => permissions.includes(perm);

  return {
    ...baseApi,
    data: {
      ...baseApi.data,
      // Wrap File System calls with permission check
      fs: {
        readFile: async (path: string) => {
          if (!hasPermission("filesystem")) {
            const msg = `Security Violation: Plugin '${pluginId}' attempted to read file '${path}' without 'filesystem' permission.`;
            console.error(msg);
            baseApi.ui.showNotification(msg);
            throw new Error(msg);
          }
          return baseApi.data.fs.readFile(path);
        },
        writeFile: async (path: string, content: number[]) => {
          if (!hasPermission("filesystem")) {
            const msg = `Security Violation: Plugin '${pluginId}' attempted to write file '${path}' without 'filesystem' permission.`;
            console.error(msg);
            baseApi.ui.showNotification(msg);
            throw new Error(msg);
          }
          return baseApi.data.fs.writeFile(path, content);
        }
      }
    }
  };
};