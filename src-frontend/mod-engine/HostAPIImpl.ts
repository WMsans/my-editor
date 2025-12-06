import { HostAPI, PluginManifest, TreeViewOptions, TreeView, TopbarItemOptions, TopbarItemControl, WebviewViewOptions, WebviewView } from "./types";
import { Editor } from "@tiptap/react";
import { registry } from "./Registry";
import { pluginEventBus } from "./events/PluginEventBus";
import { fsService } from "../services"; 
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
    if (!root) return path; 
    if (path.startsWith("/") || path.match(/^[a-zA-Z]:/)) return path; 
    const sep = root.includes("\\") ? "\\" : "/";
    return `${root}${sep}${path}`;
  };

  return {
    // [PHASE 4] Event Bus via Unified Bus
    events: {
        emit: (event, data) => pluginEventBus.emit(event, data),
        on: (event, handler) => {
            const unsub = pluginEventBus.on(event, handler);
            return { dispose: unsub };
        }
    },

    window: {
      createTreeView: <T>(viewId: string, options: TreeViewOptions<T>): TreeView<T> => {
        // Tree views are now data-driven and handled by the PluginController
        // Logic specific to the runtime (Worker/Main) is handled in the Controller.
        // This method in HostAPI is primarily for Local/Main-thread plugins.
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
          return {
              update: (html) => console.log("Update not implemented for static registration"),
              dispose: () => console.log("Dispose not implemented")
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
      },
      registerWebviewBlock: (id, options) => {
         const ext = createWebviewBlockExtension({ id, ...options });
         registry.registerExtension(ext);
      },
      insertContent: (content) => {
        getEditor()?.chain().focus().insertContent(content).run();
      },
      insertContentAt: (range, content) => {
        getEditor()?.chain().focus().insertContentAt(range, content).run();
      }
    },
    ui: {
      registerSidebarTab: (tab) => registry.registerSidebarTab(tab),
      showNotification: (msg) => setWarningMsg(msg)
    },
    commands: {
      registerCommand: (id, handler) => registry.registerCommand(id, handler),
      executeCommand: (id, args) => registry.executeCommand(id, args)
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
        // [PHASE 4] Use FileSystemService instead of direct invokes
        readFile: async (path: string) => {
          return await fsService.readFile(resolvePath(path));
        },
        writeFile: async (path: string, content: number[]) => {
          await fsService.writeFile(resolvePath(path), content);
          // Broadcast is handled by service or DocumentRegistry if needed, 
          // but here we keep the raw fs behavior. 
          // Note: P2P broadcast usually happens in DocumentRegistry. 
          // If we need raw FS broadcast, we can add it here.
        },
        createDirectory: async (path: string) => {
          return await fsService.createDirectory(resolvePath(path));
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
        },
        createTopbarItem: (options) => {
            registry.registerTopbarItem({ ...options, pluginId });
             return {
                 update: (opt) => registry.updateTopbarItem(options.id, opt),
                 dispose: () => registry.removeTopbarItem(options.id)
             };
        }
    },
    editor: {
        ...baseApi.editor,
        registerWebviewBlock: (id, options) => {
            baseApi.editor.registerWebviewBlock(id, { ...options, pluginId });
        }
    },
    data: {
      ...baseApi.data,
      fs: {
        readFile: async (path: string) => {
          if (!hasPermission("filesystem")) {
            const msg = `Security Violation: Plugin '${pluginId}' attempted to read file without permission.`;
            baseApi.ui.showNotification(msg);
            throw new Error(msg);
          }
          return baseApi.data.fs.readFile(path);
        },
        writeFile: async (path: string, content: number[]) => {
          if (!hasPermission("filesystem")) {
            const msg = `Security Violation: Plugin '${pluginId}' attempted to write file without permission.`;
            baseApi.ui.showNotification(msg);
            throw new Error(msg);
          }
          return baseApi.data.fs.writeFile(path, content);
        },
        createDirectory: async (path: string) => {
          if (!hasPermission("filesystem")) {
             const msg = `Security Violation: Plugin '${pluginId}' attempted to create directory without permission.`;
             baseApi.ui.showNotification(msg);
             throw new Error(msg);
          }
          return baseApi.data.fs.createDirectory(path);
        }
      }
    }
  };
};