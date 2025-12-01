import { WorkerMessage, MainMessage, ApiRequestPayload, ApiResponsePayload } from "./messages";

// --- State ---
const commandHandlers = new Map<string, Function>();
const pendingRequests = new Map<string, { resolve: Function, reject: Function }>();
const activeWorkerPlugins = new Map<string, any>();

// --- Helper: Send to Main ---
const postToMain = (msg: MainMessage) => {
    self.postMessage(msg);
};

// --- Helper: Create UUID ---
const uuid = () => Math.random().toString(36).substring(2, 15);

// --- API Proxy Factory ---
const createWorkerAPI = (pluginId: string) => {
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
        // UI: Limited in Worker
        ui: {
            showNotification: (msg: string) => callMain('ui', 'showNotification', msg),
            registerSidebarTab: () => console.warn(`[${pluginId}] Sidebar tabs not supported in worker mode.`)
        },
        // Commands: Local handler + Remote registration
        commands: {
            registerCommand: (id: string, handler: Function) => {
                commandHandlers.set(id, handler);
                // Tell main thread to forward execution here
                postToMain({ type: 'REGISTER_COMMAND_PROXY', payload: { id, pluginId } });
            },
            executeCommand: (id: string, args?: any) => callMain('commands', 'executeCommand', id, args)
        },
        // Data: Proxied to Main
        data: {
            fs: {
                readFile: (path: string) => callMain('data.fs', 'readFile', path),
                writeFile: (path: string, content: number[]) => callMain('data.fs', 'writeFile', path, content)
            },
            // YJS Docs are complex to proxy perfectly. 
            // Simplified: Workers might work on snapshots or raw data in this v1.
            getDoc: () => { throw new Error("Direct Y.Doc access not available in Worker yet."); }
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
                
                // No React/Tiptap access in Worker
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
                    postToMain({ type: 'LOG', payload: { level: 'info', message: `Worker Plugin '${pluginId}' deactivated.` } });
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
    }
};