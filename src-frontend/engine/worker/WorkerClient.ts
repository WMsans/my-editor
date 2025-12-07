import { HostAPI } from "../types";
import { registry } from "../registry/Registry";
import { commandService } from "../api/CommandService";
import { RPCManager } from "./rpc";
import { createWebviewBlockExtension } from "../../ui/features/sidebar/WebviewBlock";

export class WorkerClient {
    private worker: Worker;
    private rpc: RPCManager;
    private api: HostAPI;

    constructor(api: HostAPI) {
        this.api = api;
        this.worker = new Worker(new URL('./PluginWorker.ts', import.meta.url), { type: 'module' });
        
        // Initialize RPC Layer
        this.rpc = new RPCManager((msg) => this.worker.postMessage(msg));
        this.worker.onmessage = (e) => this.rpc.handleMessage(e.data);
        this.worker.onerror = (e) => console.error("Plugin Worker Error:", e);

        this.setupRPCHandlers();
        this.setupEventBridge();
    }

    private setupEventBridge() {
        // Forward Registry events to Worker
        registry.subscribeToAll((event, data) => {
            this.worker.postMessage({ type: 'EVENT', payload: { event, data } });
        });
    }

    private setupRPCHandlers() {
        // --- 1. Commands ---
        this.rpc.register('command:register', (payload: { id: string }) => {
            commandService.registerCommand(payload.id, (args) => {
                // Execute command inside worker
                this.rpc.request('command:execute', { id: payload.id, args });
            });
        });

        // --- 2. API Proxy (Generic) ---
        this.rpc.register('api:call', async (payload: { module: string, method: string, args: any[] }) => {
            const { module, method, args } = payload;
            let target: any;
            
            // Route to correct API namespace
            if (module === 'data.fs') target = this.api.data.fs;
            else if (module === 'ui') target = this.api.ui;
            else if (module === 'commands') target = this.api.commands;
            else if (module === 'plugins') target = this.api.plugins;
            else if (module === 'editor') target = this.api.editor; 
            
            if (target && typeof target[method] === 'function') {
                return await target[method](...args);
            }
            throw new Error(`API method ${module}.${method} not found or not exposed.`);
        });

        // --- 3. UI Registrations ---
        this.rpc.register('ui:webviewBlock', (payload: any) => {
            const { id, options, pluginId } = payload;
            const extension = createWebviewBlockExtension({ id, ...options, pluginId });
            registry.registerExtension(extension);
        });

        this.rpc.register('ui:webviewView', (payload: any) => {
            registry.registerWebviewView(payload.viewId, { ...payload.options, pluginId: payload.pluginId });
        });

        this.rpc.register('ui:topbar', (payload: any) => {
            if (payload.action === 'register') {
                registry.registerTopbarItem({
                    ...payload.options,
                    pluginId: payload.pluginId,
                    onClick: () => this.rpc.request('topbar:event', { id: payload.id, type: 'onClick' }),
                    onChange: (val: string) => this.rpc.request('topbar:event', { id: payload.id, type: 'onChange', value: val })
                });
            } else if (payload.action === 'update') {
                registry.updateTopbarItem(payload.id, payload.options);
            }
        });
        
        // Bubble Menu
        this.rpc.register('ui:bubbleItem', (payload: any) => {
            registry.registerBubbleItem({ ...payload.options, pluginId: payload.pluginId });
        });

        // --- 4. Event Bus ---
        this.rpc.register('event:emit', (payload: { event: string, data: any }) => {
            registry.emit(payload.event, payload.data);
        });
    }

    // --- Public Methods ---

    loadPlugin(pluginId: string, code: string, manifest: any) {
        this.worker.postMessage({ type: 'LOAD', payload: { pluginId, code, manifest } });
    }

    deactivatePlugin(pluginId: string) {
        this.worker.postMessage({ type: 'DEACTIVATE', payload: { pluginId } });
    }

    public requestTreeData(viewId: string, action: 'getChildren' | 'getTreeItem', element?: any): Promise<any> {
        return this.rpc.request('tree:request', { viewId, action, element });
    }

    terminate() {
        this.worker.terminate();
    }
}