import { WorkerMessage, MainMessage, ApiRequestPayload, ApiResponsePayload, TreeViewRequestPayload, TreeViewResponsePayload, RegisterTopbarItemPayload, UpdateTopbarItemPayload, TopbarItemEventPayload, EventPayload, RegisterBlockProxyPayload, BlockInstanceEventPayload } from "./messages";
import { HostAPI, TreeDataProvider, TreeItem, TopbarItemOptions, BlockDefinition } from "../types";

// --- State ---
const commandHandlers = new Map<string, Function>();
const pendingRequests = new Map<string, { resolve: Function, reject: Function }>();
const activeWorkerPlugins = new Map<string, any>();

// [PHASE 2] UI Data Providers
const treeDataProviders = new Map<string, TreeDataProvider<any>>();
const topbarEventHandlers = new Map<string, { onChange?: Function, onClick?: Function }>();

// [PHASE 4] Event Listeners
const eventListeners = new Map<string, ((data: any) => void)[]>();
// Block Event Handlers: Map<BlockType, Map<InstanceId, Handler>> ?? 
// Actually simpler: Map<BlockType, Handler(instanceId, event, data)>
const blockEventHandlers = new Map<string, (instanceId: string, event: string, data: any) => void>();

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
            createTreeView: (viewId, options) => {
                console.log(`[Worker] Registering TreeView: ${viewId}`);
                treeDataProviders.set(viewId, options.treeDataProvider);
                
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
            createTopbarItem: (options: TopbarItemOptions) => {
                const handlers: any = {};
                const { ...safeOptions } = options as any;
                
                if (safeOptions.onClick) {
                    handlers.onClick = safeOptions.onClick;
                    delete safeOptions.onClick;
                }
                if (safeOptions.onChange) {
                    handlers.onChange = safeOptions.onChange;
                    delete safeOptions.onChange;
                }
                topbarEventHandlers.set(options.id, handlers);

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
                    }
                };
            },
            showInformationMessage: (message, ...items) => {
                // @ts-ignore
                return callMain('ui', 'showNotification', message) as Promise<string | undefined>; 
            }
        },
        
        ui: {
            showNotification: (msg: string) => callMain('ui', 'showNotification', msg),
            registerSidebarTab: () => console.warn(`[${pluginId}] Sidebar tabs not supported in worker mode.`)
        },
        
        commands: {
            registerCommand: (id: string, handler: (args: any) => void) => {
                commandHandlers.set(id, handler);
                postToMain({ type: 'REGISTER_COMMAND_PROXY', payload: { id, pluginId } });
            },
            executeCommand: (id: string, args?: any) => callMain('commands', 'executeCommand', id, args)
        },
        
        editor: {
            // [NEW] Worker Block API
            registerBlock: (definition: BlockDefinition) => {
                console.log(`[Worker] Registering Block: ${definition.type}`);
                
                // Store the handler locally if provided
                if (definition.onEvent) {
                    blockEventHandlers.set(definition.type, definition.onEvent);
                }

                // Send registration to main to create Tiptap node
                // Note: We do NOT send definition.onEvent to main thread (functions can't be serialized)
                const payload: RegisterBlockProxyPayload = {
                    type: definition.type,
                    initialHtml: definition.template,
                    pluginId
                };
                postToMain({ type: 'REGISTER_BLOCK_PROXY', payload });
            },

            postMessage: (instanceId: string, event: string, data: any) => {
                const payload: BlockInstanceEventPayload = {
                    instanceId,
                    event,
                    data
                };
                postToMain({ type: 'BLOCK_INSTANCE_EVENT', payload });
            },

            registerExtension: () => {}, // Not supported in worker yet
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
             isEnabled: () => true,
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
                const api = createWorkerAPI(pluginId);
                const exports: any = {};
                const module = { exports };
                
                const syntheticRequire = (mod: string) => {
                    throw new Error(`Module '${mod}' is not available in Worker environment.`);
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

        case 'TOPBAR_ITEM_EVENT': {
             const { id, type: eventType, value } = payload as TopbarItemEventPayload;
             const handlers = topbarEventHandlers.get(id);
             if (handlers) {
                 if (eventType === 'onClick' && handlers.onClick) handlers.onClick();
                 if (eventType === 'onChange' && handlers.onChange) handlers.onChange(value);
             }
             break;
        }

        case 'EVENT': {
            const { event, data } = payload as EventPayload;
            const handlers = eventListeners.get(event);
            handlers?.forEach(h => {
                try { h(data); } catch(e) { console.error(`Error in worker event listener for ${event}:`, e); }
            });
            break;
        }

        // [PHASE 4] Handle Block Events from UI
        case 'BLOCK_INSTANCE_EVENT': {
            const { instanceId, event, data } = payload;
            // Find which block type this event belongs to? 
            // The protocol is slightly loose here, but typically we'd know the type from the context or the payload.
            // For simplicity, we iterate all block handlers (assuming event names are unique enough or plugins filter them).
            // Better approach: Main thread sends 'type' in payload, or we store mapping.
            // Current simplification: Iterate all registered blocks.
            blockEventHandlers.forEach(handler => {
                try {
                    handler(instanceId, event, data);
                } catch(e) {
                    console.error("Error in block event handler:", e);
                }
            });
            break;
        }
    }
};