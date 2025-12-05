import { HostAPI, PluginManifest, TreeViewOptions, TreeView, TopbarItemOptions, TopbarItemControl, WebviewViewOptions, WebviewView } from "./types";
import { Editor } from "@tiptap/react";
import { registry } from "./Registry";
import { invoke } from "@tauri-apps/api/core";
import * as Y from "yjs";
import { createWebviewBlockExtension } from "../components/WebviewBlock";

interface PluginManager {
  getAll: () => Promise<PluginManifest[]>;
  isEnabled: (id: string) => boolean;
  setEnabled: (id: string, enabled: boolean) => void;
}

export const createHostAPI = (
  getEditor: () => Editor | null,
  getRootPath: () => string | null, 
  setWarningMsg: (msg: string) => void,
  pluginManager?: PluginManager 
): HostAPI => {
  
  // Helper to resolve paths relative to root
  const resolvePath = (path: string) => {
    const root = getRootPath();
    if (!root) return path; // Fallback if no project open
    if (path.startsWith("/") || path.match(/^[a-zA-Z]:/)) return path; // Already absolute
    const sep = root.includes("\\") ? "\\" : "/";
    return `${root}${sep}${path}`;
  };

  return {
    // [PHASE 4] Event Bus
    events: {
        emit: (event, data) => registry.emit(event, data),
        on: (event, handler) => registry.on(event, handler)
    },

    // [PHASE 2] Window API Implementation
    window: {
      createTreeView: <T>(viewId: string, options: TreeViewOptions<T>): TreeView<T> => {
        console.log(`[Main] TreeView registered: ${viewId}`);
        return {
          dispose: () => console.log(`[Main] TreeView disposed: ${viewId}`),
          reveal: async (element, options) => {
            console.log(`[Main] Reveal requested for ${viewId}`, element);
          }
        };
      },
      registerWebviewView: (viewId: string, options: WebviewViewOptions): WebviewView => {
          registry.registerWebviewView(viewId, options);
          console.log(`[Main] Webview View registered: ${viewId}`);
          return {
              update: (html) => console.log("Update not implemented for static registration"),
              dispose: () => console.log("Dispose not implemented")
          };
      },
      // [NEW] Local implementation (for local plugins)
      createTopbarItem: (options: TopbarItemOptions): TopbarItemControl => {
         registry.registerTopbarItem({ ...options, pluginId: 'host-local' });
         return {
             update: (opt) => registry.updateTopbarItem(options.id, opt),
             dispose: () => registry.removeTopbarItem(options.id)
         };
      },
      showInformationMessage: async (message: string, ...items: string[]) => {
        setWarningMsg(message);
        return undefined;
      }
    },

    editor: {
      getSafeInstance: () => getEditor(),
      getCommands: () => getEditor()?.commands || null,
      getState: () => getEditor()?.state || null,
      registerExtension: (ext, options) => {
        const priority = options?.priority || 'normal';
        registry.registerExtension(ext, priority);
        console.log(`Extension registered (Priority: ${priority})`);
      },
      registerWebviewBlock: (id, options) => {
         // Note: If called directly via 'baseApi' (not scoped), pluginId might be missing.
         // This is fine for internal tools, but plugins should use scoped API.
         const ext = createWebviewBlockExtension({ id, ...options });
         registry.registerExtension(ext);
         console.log(`[Main] Registered Webview Block: ${id}`);
      },
      insertContent: (content) => {
        getEditor()?.chain().focus().insertContent(content).run();
      },
      insertContentAt: (range, content) => {
        getEditor()?.chain().focus().insertContentAt(range, content).run();
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
          return await invoke<number[]>("read_file_content", { path: resolvePath(path) });
        },
        writeFile: async (path: string, content: number[]) => {
          await invoke("write_file_content", { path: resolvePath(path), content });
          await invoke("broadcast_update", { path, data: content });
        },
        createDirectory: async (path: string) => {
          return await invoke("create_directory", { path: resolvePath(path) });
        }
      }
    },
    plugins: {
        getAll: async () => pluginManager ? pluginManager.getAll() : [],
        isEnabled: async (id) => pluginManager ? pluginManager.isEnabled(id) : true,
        setEnabled: (id, val) => pluginManager?.setEnabled(id, val)
    }
  };
};

export const createScopedAPI = (baseApi: HostAPI, pluginId: string, permissions: string[] = []): HostAPI => {
  const hasPermission = (perm: string) => permissions.includes(perm);

  return {
    ...baseApi,
    window: {
        ...baseApi.window,
        registerWebviewView: (viewId, options) => {
            return baseApi.window.registerWebviewView(viewId, { ...options, pluginId });
        }
    },
    editor: {
        ...baseApi.editor,
        registerWebviewBlock: (id, options) => {
            // Automatically attach the pluginId to the webview options
            // This enables the "plugin://<id>/" scheme in the frontend component
            baseApi.editor.registerWebviewBlock(id, { ...options, pluginId });
        }
    },
    data: {
      ...baseApi.data,
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
        },
        createDirectory: async (path: string) => {
          if (!hasPermission("filesystem")) {
            const msg = `Security Violation: Plugin '${pluginId}' attempted to create directory '${path}' without 'filesystem' permission.`;
            console.error(msg);
            baseApi.ui.showNotification(msg);
            throw new Error(msg);
          }
          return baseApi.data.fs.createDirectory(path);
        }
      }
    }
  };
};