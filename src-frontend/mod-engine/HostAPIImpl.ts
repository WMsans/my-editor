import { HostAPI, PluginManifest, TreeViewOptions, TreeView, TopbarItemOptions, TopbarItemControl, WebviewViewOptions, WebviewView } from "./types";
import { Editor } from "@tiptap/react";
import { EditorState } from "@tiptap/pm/state";
import { registry } from "./Registry";
import { pluginEventBus } from "./events/PluginEventBus";
import { fsService, workspaceManager } from "../services";
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
  
  const resolvePath = (path: string): string => {
    const root = getRootPath();
    if (!root) return path; 
    if (path.startsWith("/") || path.match(/^[a-zA-Z]:/)) return path; 
    const sep = root.includes("\\") ? "\\" : "/";
    return `${root}${sep}${path}`;
  };

  return {
    events: {
        emit: (event: string, data?: unknown) => pluginEventBus.emit(event, data),
        on: (event: string, handler: (data: unknown) => void) => {
            const unsub = pluginEventBus.on(event, handler);
            return { dispose: unsub };
        }
    },

    window: {
      createTreeView: <T>(viewId: string, options: TreeViewOptions<T>): TreeView<T> => {
        console.log(`[Main] TreeView registered: ${viewId}`);
        return {
          dispose: () => console.log(`[Main] TreeView disposed: ${viewId}`),
          reveal: async (_element: T, _options?) => { /* impl */ }
        };
      },
      registerWebviewView: (viewId: string, options: WebviewViewOptions): WebviewView => {
          registry.registerWebviewView(viewId, options);
          return {
              update: (_html: string) => {},
              dispose: () => {}
          };
      },
      createTopbarItem: (options: TopbarItemOptions): TopbarItemControl => {
         registry.registerTopbarItem({ ...options, pluginId: 'host-local' });
         return {
             update: (opt) => registry.updateTopbarItem(options.id, opt),
             dispose: () => registry.removeTopbarItem(options.id)
         };
      },
      showInformationMessage: async (message: string, ..._items: string[]) => {
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
      insertContent: (content: unknown) => {
        getEditor()?.chain().focus().insertContent(content as any).run();
      },
      insertContentAt: (range: { from: number; to: number }, content: unknown) => {
        getEditor()?.chain().focus().insertContentAt(range, content as any).run();
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
      getDoc: (): Y.Doc => {
        const doc = workspaceManager.getCurrentDoc();
        return doc || new Y.Doc();
      },
      getMap: (name: string): Y.Map<unknown> => {
        const doc = workspaceManager.getCurrentDoc() || new Y.Doc();
        return doc.getMap(name); 
      },
      fs: {
        readFile: async (path: string) => await fsService.readFile(resolvePath(path)),
        writeFile: async (path: string, content: number[]) => await fsService.writeFile(resolvePath(path), content),
        createDirectory: async (path: string) => await fsService.createDirectory(resolvePath(path))
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
          if (!hasPermission("filesystem")) throw new Error(`Permission denied: filesystem`);
          return baseApi.data.fs.readFile(path);
        },
        writeFile: async (path, content) => {
          if (!hasPermission("filesystem")) throw new Error(`Permission denied: filesystem`);
          return baseApi.data.fs.writeFile(path, content);
        },
        createDirectory: async (path) => {
          if (!hasPermission("filesystem")) throw new Error(`Permission denied: filesystem`);
          return baseApi.data.fs.createDirectory(path);
        }
      }
    }
  };
};