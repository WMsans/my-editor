import { RPCManager } from "./rpc";
import { HostAPI, TreeDataProvider, TopbarItemOptions } from "../types";

// --- State ---
const activeWorkerPlugins = new Map<string, any>();
const treeDataProviders = new Map<string, TreeDataProvider<any>>();

const eventListeners = new Map<string, Set<(data: any) => void>>();
const topbarItems = new Map<string, TopbarItemOptions>();

// --- RPC Setup ---
const rpc = new RPCManager((msg) => self.postMessage(msg));

// --- API Implementation ---
const createWorkerAPI = (pluginId: string): HostAPI => {
    return {
        events: {
            emit: (event, data) => rpc.request('event:emit', { event, data }),
            on: (event, handler) => {
                if (!eventListeners.has(event)) {
                    eventListeners.set(event, new Set());
                }
                eventListeners.get(event)!.add(handler);
                
                return { 
                    dispose: () => {
                        const listeners = eventListeners.get(event);
                        if (listeners) {
                            listeners.delete(handler);
                            if (listeners.size === 0) eventListeners.delete(event);
                        }
                    } 
                };
            }
        },
        window: {
            createTreeView: (viewId, options) => {
                treeDataProviders.set(viewId, options.treeDataProvider);
                return { dispose: () => treeDataProviders.delete(viewId), reveal: async () => {} };
            },
            registerWebviewView: (viewId, options) => {
                rpc.request('ui:webviewView', { viewId, options, pluginId });
                return { update: () => {}, dispose: () => {} };
            },
            createTopbarItem: (options) => {
                // Store options locally to keep the callback references (onClick, onChange)
                topbarItems.set(options.id, options);

                // Send registration to main thread (callbacks won't serialize, but ID maps them back)
                rpc.request('ui:topbar', { action: 'register', id: options.id, pluginId, options });
                
                return {
                    update: (opts) => {
                        // Update local cache
                        const existing = topbarItems.get(options.id);
                        if (existing) Object.assign(existing, opts);

                        rpc.request('ui:topbar', { action: 'update', id: options.id, options: opts });
                    },
                    dispose: () => {
                        topbarItems.delete(options.id);
                        // Ideally send a dispose RPC if supported
                    } 
                };
            },
            showInformationMessage: (msg) => rpc.request('api:call', { module: 'ui', method: 'showNotification', args: [msg] })
        },
        commands: {
            registerCommand: (id, handler) => {
                // Register locally and notify main
                (self as any)._commandHandlers = (self as any)._commandHandlers || new Map();
                (self as any)._commandHandlers.set(id, handler);
                rpc.request('command:register', { id });
            },
            executeCommand: (id, args) => rpc.request('api:call', { module: 'commands', method: 'executeCommand', args: [id, args] })
        },
        editor: {
            registerExtension: () => {},
            registerWebviewBlock: (id, options) => rpc.request('ui:webviewBlock', { id, options, pluginId }),
            insertContent: (content) => rpc.request('api:call', { module: 'editor', method: 'insertContent', args: [content] }),
            insertContentAt: (range, content) => rpc.request('api:call', { module: 'editor', method: 'insertContentAt', args: [range, content] }),
            getCommands: () => ({}),
            getState: () => null,
            getSafeInstance: () => null
        },
        ui: {
            showNotification: (msg) => rpc.request('api:call', { module: 'ui', method: 'showNotification', args: [msg] }),
            registerSidebarTab: () => {}
        },
        data: {
            fs: {
                readFile: (path) => rpc.request('api:call', { module: 'data.fs', method: 'readFile', args: [path] }),
                writeFile: (path, content) => rpc.request('api:call', { module: 'data.fs', method: 'writeFile', args: [path, content] }),
                createDirectory: (path) => rpc.request('api:call', { module: 'data.fs', method: 'createDirectory', args: [path] })
            },
            getDoc: () => { throw new Error("Not supported in worker"); },
            getMap: () => { throw new Error("Not supported in worker"); }
        },
        plugins: {
            getAll: () => rpc.request('api:call', { module: 'plugins', method: 'getAll', args: [] }),
            isEnabled: (id) => rpc.request('api:call', { module: 'plugins', method: 'isEnabled', args: [id] }),
            setEnabled: (id, val) => rpc.request('api:call', { module: 'plugins', method: 'setEnabled', args: [id, val] })
        }
    };
};

// --- Message Handlers ---
self.onmessage = async (e: MessageEvent) => {
    // 1. Handle RPC
    if (e.data.type?.startsWith('RPC_')) {
        rpc.handleMessage(e.data);
        return;
    }

    // 2. Handle System Messages
    const { type, payload } = e.data;

    if (type === 'LOAD') {
        const { pluginId, code } = payload;
        try {
            const api = createWorkerAPI(pluginId);
            const exports: any = {};
            const runPlugin = new Function("exports", "require", "module", "api", code);
            
            runPlugin(exports, () => { throw new Error("require not supported") }, { exports }, api);
            activeWorkerPlugins.set(pluginId, exports);
            
            if (exports.activate) await exports.activate(api);
        } catch (err) {
            console.error(`[Worker] Failed to load ${pluginId}`, err);
        }
    }
    else if (type === 'EVENT') {
        const { event, data } = payload;
        const listeners = eventListeners.get(event);
        if (listeners) {
            listeners.forEach(handler => {
                try { handler(data); } catch (e) { console.error(`Error in event handler for ${event}`, e); }
            });
        }
    }
};

// --- Incoming RPC Registrations ---
rpc.register('tree:request', async (payload: any) => {
    const { viewId, action, element } = payload;
    const provider = treeDataProviders.get(viewId);
    if (!provider) throw new Error("Provider not found");
    
    if (action === 'getChildren') return await provider.getChildren(element);
    if (action === 'getTreeItem') return await provider.getTreeItem(element);
});

rpc.register('command:execute', async (payload: { id: string, args: any }) => {
    const handler = (self as any)._commandHandlers?.get(payload.id);
    if (handler) await handler(payload.args);
});

rpc.register('topbar:event', async (payload: { id: string, type: 'onClick' | 'onChange', value?: any }) => {
    const item = topbarItems.get(payload.id);
    if (!item) return;

    if (payload.type === 'onClick' && item.onClick) {
        item.onClick();
    } else if (payload.type === 'onChange' && item.onChange) {
        item.onChange(payload.value);
    }
});