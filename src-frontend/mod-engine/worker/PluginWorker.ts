import { WorkerMessage, MainMessage, ApiRequestPayload, ApiResponsePayload, TreeViewRequestPayload, TreeViewResponsePayload } from "./messages";
import { HostAPI, TreeDataProvider, TreeItem } from "../types";

// --- State ---
const commandHandlers = new Map<string, Function>();
const pendingRequests = new Map<string, { resolve: Function, reject: Function }>();
const activeWorkerPlugins = new Map<string, any>();

// [PHASE 2] UI Data Providers
const treeDataProviders = new Map<string, TreeDataProvider<any>>();

// --- Helper: Send to Main ---
const postToMain = (msg: MainMessage) => {
    self.postMessage(msg);
};

// --- Helper: Create UUID ---
const uuid = () => Math.random().toString(36).substring(2, 15);

// --- API Proxy Factory ---
const createWorkerAPI = (pluginId: string): HostAPI => {
    // Generic proxy for async methods
    const callMain = (module: string, method: string, ...args: any[]) => {
        return new Promise((resolve, reject) => {
            const requestId = uuid();
            pendingRequests.set(requestId, { resolve, reject });
            
            const payload: ApiRequestPayload = {
                requestId,
                module,
                method,
                args,
                pluginId
            };
            
            postToMain({ type: 'API_REQUEST', payload });
        });
    };

    return {
        // [PHASE 2] Window API (Data Driven)
        window: {
            createTreeView: (viewId, options) => {
                console.log(`[Worker] Registering TreeView: ${viewId}`);
                treeDataProviders.set(viewId, options.treeDataProvider);
                
                // Notify Main thread that this view is now backed by data
                postToMain({ 
                    type: 'TREE_VIEW_REGISTER', 
                    payload: { viewId, pluginId } 
                });

                return {
                    dispose: () => treeDataProviders.delete(viewId),
                    reveal: async (element, options) => {
                        // Not implemented in Phase 2
                    }
                };
            },
            showInformationMessage: (message, ...items) => {
                // @ts-ignore
                return callMain('ui', 'showNotification', message) as Promise<string | undefined>; 
            }
        },
        
        // UI: Legacy / Limited
        ui: {
            showNotification: (msg: string) => callMain('ui', 'showNotification', msg),
            registerSidebarTab: () => console.warn(`[${pluginId}] Sidebar tabs not supported in worker mode. Use window.createTreeView.`)
        },
        
        // Commands: Local handler + Remote registration
        commands: {
            registerCommand: (id: string, handler: (args: any) => void) => {
                commandHandlers.set(id, handler);
                // Tell main thread to forward execution here
                postToMain({ type: 'REGISTER_COMMAND_PROXY', payload: { id, pluginId } });
            },
            executeCommand: (id: string, args?: any) => callMain('commands', 'executeCommand', id, args)
        },
        
        editor: {
            // Stubbed for Types; Workers can't access Editor directly yet
            registerExtension: () => {},
            getCommands: () => ({}),
            getState: () => null,
            getSafeInstance: () => null,
        },

        // Data: Proxied to Main
        data: {
            fs: {
                readFile: (path: string) => callMain('data.fs', 'readFile', path) as Promise<number[]>,
                writeFile: (path: string, content: number[]) => callMain('data.fs', 'writeFile', path, content) as Promise<void>,
                createDirectory: (path: string) => callMain('data.fs', 'createDirectory', path) as Promise<void>
            },
            getDoc: () => { throw new Error("Direct Y.Doc access not available in Worker yet."); },
            getMap: (name) => { throw new Error("Direct Y.Map access not available in Worker yet."); }
        },
        plugins: {
             getAll: () => callMain('plugins', 'getAll') as Promise<any>,
             isEnabled: () => true, // Sync check difficult in worker
             setEnabled: (id, val) => callMain('plugins', 'setEnabled', id, val)
        }
    };
};

// --- Message Listener ---
self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
    const { type, payload } = e.data;

    switch (type) {
        case 'LOAD': {
            const { pluginId, code, manifest } = payload;
            try {
                // Synthetic Environment
                const api = createWorkerAPI(pluginId);
                const exports: any = {};
                const module = { exports };
                
                // [PHASE 2] Remove React/DOM injection
                // We intentionally do NOT pass React, ReactDOM, or Tiptap.
                // Plugins must use the API to define UI.
                const syntheticRequire = (mod: string) => {
                    throw new Error(`Module '${mod}' is not available in Worker environment. Use the Host API.`);
                };

                const runPlugin = new Function("exports", "require", "module", "api", code);
                runPlugin(exports, syntheticRequire, module, api);

                activeWorkerPlugins.set(pluginId, exports);

                if (exports.activate) {
                    await exports.activate(api);
                    postToMain({ type: 'LOG', payload: { level: 'info', message: `Worker Plugin '${pluginId}' activated.` } });
                }
            } catch (err: any) {
                postToMain({ type: 'LOG', payload: { level: 'error', message: `Worker Init Error (${pluginId}): ${err.toString()}` } });
            }
            break;
        }

        case 'DEACTIVATE': {
            const { pluginId } = payload;
            const instance = activeWorkerPlugins.get(pluginId);
            if (instance && instance.deactivate) {
                try {
                    await instance.deactivate();
                } catch (e: any) {
                    console.error(`Error deactivating ${pluginId}:`, e);
                }
            }
            activeWorkerPlugins.delete(pluginId);
            break;
        }

        case 'EXEC_COMMAND': {
            const { id, args } = payload;
            const handler = commandHandlers.get(id);
            if (handler) {
                try {
                    await handler(args);
                } catch (err: any) {
                    console.error(`Command '${id}' failed in worker:`, err);
                }
            }
            break;
        }

        case 'API_RESPONSE': {
            const { requestId, success, data, error } = payload as ApiResponsePayload;
            const pending = pendingRequests.get(requestId);
            if (pending) {
                if (success) pending.resolve(data);
                else pending.reject(new Error(error));
                pendingRequests.delete(requestId);
            }
            break;
        }

        // [PHASE 2] Handle Tree View Data Requests
        case 'TREE_VIEW_REQUEST': {
            const { requestId, viewId, action, element } = payload as TreeViewRequestPayload;
            const provider = treeDataProviders.get(viewId);
            
            const response: TreeViewResponsePayload = { requestId, data: null };

            if (!provider) {
                response.error = `No provider found for view ${viewId}`;
            } else {
                try {
                    if (action === 'getChildren') {
                        response.data = await provider.getChildren(element);
                    } else if (action === 'getTreeItem') {
                        response.data = await provider.getTreeItem(element);
                    }
                } catch (e: any) {
                    response.error = e.toString();
                }
            }

            postToMain({ type: 'TREE_VIEW_RESPONSE', payload: response });
            break;
        }
    }
};