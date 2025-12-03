import { WorkerMessage, MainMessage, ApiRequestPayload, ApiResponsePayload, TreeViewRequestPayload, TreeViewResponsePayload, RegisterTopbarItemPayload, UpdateTopbarItemPayload, TopbarItemEventPayload, EventPayload, RegisterWebviewBlockProviderPayload, WebviewBlockResolvePayload } from "./messages";
import { HostAPI, TreeDataProvider, TreeItem, TopbarItemOptions, WebviewBlockProvider } from "../types";
import { CreateWebviewPayload, UpdateWebviewHtmlPayload, WebviewPostMessagePayload, WebviewDisposePayload } from "./messages";

// --- State ---
const commandHandlers = new Map<string, Function>();
const pendingRequests = new Map<string, { resolve: Function, reject: Function }>();
const activeWorkerPlugins = new Map<string, any>();

// [PHASE 2] UI Data Providers
const treeDataProviders = new Map<string, TreeDataProvider<any>>();
const topbarEventHandlers = new Map<string, { onChange?: Function, onClick?: Function }>();
// [NEW] Webview Block Providers
const webviewBlockProviders = new Map<string, WebviewBlockProvider>();

// [PHASE 4] Event Listeners
const eventListeners = new Map<string, ((data: any) => void)[]>();

const activeWebviews = new Map<string, { onMessage?: (msg: any) => void }>();

// --- Helper: Send to Main ---
const postToMain = (msg: MainMessage) => {
    self.postMessage(msg);
};

// --- Helper: Create UUID ---
const uuid = () => Math.random().toString(36).substring(2, 15);

// --- Helper: Create Webview Proxy Object ---
const createWebviewProxy = (id: string, viewType: string, title: string) => {
    // 2. Setup Local Object
    activeWebviews.set(id, {});

    const webviewObj = {
        _html: "",
        get html() { return this._html; },
        set html(val: string) {
            this._html = val;
            postToMain({ 
                type: 'WEBVIEW_UPDATE_HTML', 
                payload: { id, html: val } as UpdateWebviewHtmlPayload 
            });
        },
        postMessage: async (message: any) => {
                postToMain({
                    type: 'WEBVIEW_POST_MESSAGE',
                    payload: { id, message } as WebviewPostMessagePayload
                });
                return true;
        },
        onDidReceiveMessage: (listener: (msg: any) => void) => {
            const wv = activeWebviews.get(id);
            if (wv) wv.onMessage = listener;
            return { dispose: () => { if (wv) wv.onMessage = undefined; } };
        }
    };

    return {
        id,
        viewType,
        title,
        webview: webviewObj,
        visible: true,
        reveal: () => {
            postToMain({ type: 'WEBVIEW_REVEAL', payload: { id } });
        },
        dispose: () => {
            activeWebviews.delete(id);
            postToMain({ type: 'WEBVIEW_DISPOSE', payload: { id } as WebviewDisposePayload });
        }
    };
};

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
        // [PHASE 4] Event Bus
        events: {
            emit: (event, data) => {
                postToMain({ type: 'EMIT_EVENT', payload: { event, data } });
            },
            on: (event, handler) => {
                if (!eventListeners.has(event)) {
                    eventListeners.set(event, []);
                }
                eventListeners.get(event)!.push(handler);
                
                return {
                    dispose: () => {
                        const handlers = eventListeners.get(event);
                        if (handlers) {
                            eventListeners.set(event, handlers.filter(h => h !== handler));
                        }
                    }
                };
            }
        },

        // [PHASE 2] Window API (Data Driven)
        window: {
            // [PHASE 5] Webview API
            createWebviewPanel: (viewType, title, options) => {
                const id = uuid();
                console.log(`[Worker] Creating Webview: ${id}`);
                
                // 1. Notify Main Thread
                const payload: CreateWebviewPayload = { id, viewType, title, options };
                postToMain({ type: 'WEBVIEW_CREATE', payload });

                return createWebviewProxy(id, viewType, title);
            },
            createTreeView: (viewId, options) => {
                console.log(`[Worker] Registering TreeView: ${viewId}`);
                treeDataProviders.set(viewId, options.treeDataProvider);
                
                // Notify Main thread that this view is now backed by data
                postToMain({ 
                    type: 'TREE_VIEW_REGISTER', 
                    payload: { viewId, pluginId } 
                });

                return {
                    dispose: () => {
                        treeDataProviders.delete(viewId);
                        postToMain({ type: 'TREE_VIEW_DISPOSE', payload: { viewId } });
                    },
                    reveal: async (element, options) => {
                        // Send request to reveal specific item in UI
                        postToMain({ 
                            type: 'TREE_VIEW_REVEAL', 
                            payload: { viewId, element, options } 
                        });
                    }
                };
            },
            // [NEW] Topbar API
            createTopbarItem: (options: TopbarItemOptions) => {
                const handlers: any = {};
                const { ...safeOptions } = options as any;
                
                // Store handlers locally
                if (safeOptions.onClick) {
                    handlers.onClick = safeOptions.onClick;
                    delete safeOptions.onClick;
                }
                if (safeOptions.onChange) {
                    handlers.onChange = safeOptions.onChange;
                    delete safeOptions.onChange;
                }
                topbarEventHandlers.set(options.id, handlers);

                // Send registration to main
                const payload: RegisterTopbarItemPayload = {
                    id: options.id,
                    pluginId,
                    options: safeOptions
                };
                postToMain({ type: 'REGISTER_TOPBAR_ITEM', payload });

                return {
                    update: (opts) => {
                        postToMain({ 
                            type: 'UPDATE_TOPBAR_ITEM', 
                            payload: { id: options.id, options: opts } 
                        });
                    },
                    dispose: () => {
                        topbarEventHandlers.delete(options.id);
                        postToMain({ 
                            type: 'DISPOSE_TOPBAR_ITEM', 
                            payload: { id: options.id } 
                        });
                    }
                };
            },
            showInformationMessage: (message, ...items) => {
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
            // [NEW] Webview Blocks
            registerWebviewBlock: (viewType, provider) => {
                webviewBlockProviders.set(viewType, provider);
                postToMain({ type: 'REGISTER_WEBVIEW_BLOCK_PROVIDER', payload: { viewType, pluginId } });
                
                return {
                    dispose: () => { webviewBlockProviders.delete(viewType); }
                };
            },

            registerExtension: () => { console.warn("Worker plugins cannot directly register Tiptap extensions. Use static contributions in manifest."); },
            getCommands: () => { console.warn("Direct command access unavailable. Use commands.executeCommand()."); return {}; },
            getState: () => { console.warn("Direct EditorState access unavailable in worker."); return null; },
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
            getMap: (name) => { throw new Error("Direct Y.Map (" + name + ") access not available in Worker yet."); }
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

        // Handle UI Events for Topbar
        case 'TOPBAR_ITEM_EVENT': {
             const { id, type: eventType, value } = payload as TopbarItemEventPayload;
             const handlers = topbarEventHandlers.get(id);
             if (handlers) {
                 if (eventType === 'onClick' && handlers.onClick) handlers.onClick();
                 if (eventType === 'onChange' && handlers.onChange) handlers.onChange(value);
             }
             break;
        }

        // [NEW] Handle Webview Block Resolution
        case 'WEBVIEW_BLOCK_RESOLVE': {
            const { viewType, webviewId } = payload as WebviewBlockResolvePayload;
            const provider = webviewBlockProviders.get(viewType);
            
            if (provider) {
                console.log(`[Worker] Resolving Webview Block '${viewType}' -> ${webviewId}`);
                // Create a proxy webview object for this ID
                const proxy = createWebviewProxy(webviewId, viewType, `Block: ${viewType}`);
                // Call the plugin
                provider.onCreate(proxy);
            } else {
                console.warn(`[Worker] No provider found for Webview Block '${viewType}'`);
            }
            break;
        }

        // [PHASE 4] Handle Application Events (Merged Logic)
        case 'EVENT': {
            const { event, data } = payload as EventPayload;
            
            // 1. Handle Webview-specific messages intercepted by Event Bus
            if (event.startsWith('webview:received-message:')) {
                const webviewId = event.split(':')[2];
                const wv = activeWebviews.get(webviewId);
                if (wv && wv.onMessage) {
                    wv.onMessage(data);
                }
                return; // Consumed
            }

            // 2. Handle standard events subscribed via api.events.on()
            const handlers = eventListeners.get(event);
            handlers?.forEach(h => {
                try { h(data); } catch(e) { console.error(`Error in worker event listener for ${event}:`, e); }
            });
            break;
        }
    }
};