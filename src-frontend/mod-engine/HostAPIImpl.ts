import { HostAPI, PluginManifest, TreeViewOptions, TreeView, TopbarItemOptions, TopbarItemControl, BlockDefinition } from "./types";
import { Editor } from "@tiptap/react";
import { registry } from "./Registry";
import { invoke } from "@tauri-apps/api/core";
import * as Y from "yjs";

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
  
  const resolvePath = (path: string) => {
    const root = getRootPath();
    if (!root) return path;
    if (path.startsWith("/") || path.match(/^[a-zA-Z]:/)) return path; 
    const sep = root.includes("\\") ? "\\" : "/";
    return `${root}${sep}${path}`;
  };

  return {
    events: {
        emit: (event, data) => registry.emit(event, data),
        on: (event, handler) => registry.on(event, handler)
    },

    window: {
      createTreeView: <T>(viewId: string, options: TreeViewOptions<T>): TreeView<T> => {
        console.log(`[Main] TreeView registered: ${viewId}`);
        return {
          dispose: () => console.log(`[Main] TreeView disposed: ${viewId}`),
          reveal: async (element, options) => {}
        };
      },
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
        
        // [FIX] Safer injection that doesn't crash if methods are missing
        const editor = getEditor();
        if (editor) {
            try {
                // @ts-ignore
                if (editor.extensionManager && editor.extensionManager.extensions) {
                     // @ts-ignore
                    editor.extensionManager.extensions.push(ext);
                    
                    // [REMOVED] editor.extensionManager.sortExtensions(); 
                    // Tiptap doesn't support live schema updates easily. 
                    // The App must re-mount the editor to apply new nodes fully.
                    console.log("Registered extension for next editor reload.");
                }
            } catch(e) {
                console.warn("Could not register extension.", e);
            }
        }
      },

      registerBlock: (definition: BlockDefinition) => {
          console.warn("registerBlock should be called via Worker proxy.");
      },
      
      postMessage: (instanceId: string, event: string, data: any) => {
          registry.emit(`worker-block-msg:${instanceId}`, { event, data });
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