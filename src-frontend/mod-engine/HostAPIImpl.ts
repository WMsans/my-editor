import { HostAPI, TopbarItemOptions, TreeViewOptions, WebviewViewOptions } from "./types";
import { Editor } from "@tiptap/react";
import { registry } from "./Registry";
import { commandService } from "./services/CommandService";
import { pluginEventBus } from "./events/PluginEventBus";
import { fsService, workspaceManager } from "../services";
import * as Y from "yjs";
import { createWebviewBlockExtension } from "../components/WebviewBlock";

const resolvePath = (path: string, root: string | null): string => {
    if (!root) return path; 
    if (path.startsWith("/") || path.match(/^[a-zA-Z]:/)) return path; 
    const sep = root.includes("\\") ? "\\" : "/";
    return `${root}${sep}${path}`;
};

export const createHostAPI = (
  getEditor: () => Editor | null,
  getRootPath: () => string | null, 
  setWarningMsg: (msg: string) => void,
  pluginManager?: any
): HostAPI => {
  
  return {
    events: {
        emit: (event, data) => pluginEventBus.emit(event, data),
        on: (event, handler) => {
            const unsub = pluginEventBus.on(event, handler);
            return { dispose: unsub };
        }
    },

    window: {
      createTreeView: <T>(viewId: string, options: TreeViewOptions<T>) => {
        // Tree View Logic is handled by PluginLoader via Data Providers
        // API just acknowledges creation
        return {
          dispose: () => {},
          reveal: async () => { /* impl */ }
        };
      },
      registerWebviewView: (viewId, options) => {
          registry.registerWebviewView(viewId, options);
          return { update: () => {}, dispose: () => {} };
      },
      createTopbarItem: (options) => {
         registry.registerTopbarItem({ ...options, pluginId: 'host-local' });
         return {
             update: (opt) => registry.updateTopbarItem(options.id, opt),
             dispose: () => registry.removeTopbarItem(options.id)
         };
      },
      showInformationMessage: async (message) => {
        setWarningMsg(message);
        return undefined;
      }
    },

    editor: {
      getSafeInstance: () => getEditor(),
      getCommands: () => getEditor()?.commands || null,
      getState: () => getEditor()?.state || null,
      registerExtension: (ext, options) => {
        registry.registerExtension(ext, options?.priority || 'normal');
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
      // Use CommandService now
      registerCommand: (id, handler) => commandService.registerCommand(id, handler),
      executeCommand: (id, args) => commandService.executeCommand(id, args)
    },
    data: {
      getDoc: () => workspaceManager.getCurrentDoc() || new Y.Doc(),
      getMap: (name) => (workspaceManager.getCurrentDoc() || new Y.Doc()).getMap(name),
      fs: {
        readFile: async (path) => await fsService.readFile(resolvePath(path, getRootPath())),
        writeFile: async (path, content) => await fsService.writeFile(resolvePath(path, getRootPath()), content),
        createDirectory: async (path) => await fsService.createDirectory(resolvePath(path, getRootPath()))
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
  
  // Create a proxy to intercept calls and inject context/permissions
  return {
    ...baseApi,
    window: {
        ...baseApi.window,
        registerWebviewView: (viewId, options) => baseApi.window.registerWebviewView(viewId, { ...options, pluginId }),
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
        registerWebviewBlock: (id, options) => baseApi.editor.registerWebviewBlock(id, { ...options, pluginId })
    },
    data: {
      ...baseApi.data,
      fs: {
        readFile: async (path) => {
          if (!hasPermission("filesystem")) throw new Error(`[${pluginId}] Permission denied: filesystem`);
          return baseApi.data.fs.readFile(path);
        },
        writeFile: async (path, content) => {
          if (!hasPermission("filesystem")) throw new Error(`[${pluginId}] Permission denied: filesystem`);
          return baseApi.data.fs.writeFile(path, content);
        },
        createDirectory: async (path) => {
          if (!hasPermission("filesystem")) throw new Error(`[${pluginId}] Permission denied: filesystem`);
          return baseApi.data.fs.createDirectory(path);
        }
      }
    }
  };
};