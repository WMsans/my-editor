import { HostAPI } from "../types";
import { MainMessage, WorkerMessage, ApiResponsePayload, TreeViewRequestPayload, TreeViewResponsePayload, RegisterTopbarItemPayload, UpdateTopbarItemPayload, EventPayload, RegisterBlockProxyPayload, BlockInstanceEventPayload } from "./messages";
import { registry } from "../Registry";

// Tiptap Imports for Dynamic Factory
import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { WorkerNodeView } from "../../components/WorkerNodeView";

export class WorkerClient {
    private worker: Worker;
    private api: HostAPI;
    
    // [PHASE 2] Request Tracking
    private pendingDataRequests = new Map<string, { resolve: Function, reject: Function }>();

    constructor(api: HostAPI) {
        this.api = api;
        // Vite syntax for worker import
        this.worker = new Worker(new URL('./PluginWorker.ts', import.meta.url), { type: 'module' });
        
        this.worker.onmessage = this.handleMessage.bind(this);
        this.worker.onerror = (e) => console.error("Plugin Worker Error:", e);

        // [PHASE 4] Bridge Events: Registry -> Worker
        registry.subscribeToAll((event, data) => {
            const msg: WorkerMessage = {
                type: 'EVENT',
                payload: { event, data }
            };
            this.worker.postMessage(msg);
        });

        // [NEW] Bridge Block Actions: UI -> Worker
        registry.on('worker-block-action', (payload: any) => {
            const msg: WorkerMessage = {
                type: 'BLOCK_INSTANCE_EVENT',
                payload: {
                    instanceId: payload.instanceId,
                    event: payload.event,
                    data: payload.data // Pass through
                }
            };
            this.worker.postMessage(msg);
        });
    }

    loadPlugin(pluginId: string, code: string, manifest: any) {
        const msg: WorkerMessage = {
            type: 'LOAD',
            payload: { pluginId, code, manifest }
        };
        this.worker.postMessage(msg);
    }

    deactivatePlugin(pluginId: string) {
        const msg: WorkerMessage = {
            type: 'DEACTIVATE',
            payload: { pluginId }
        };
        this.worker.postMessage(msg);
    }

    // [PHASE 2] Public Method for UI Components to fetch data
    public requestTreeData(viewId: string, action: 'getChildren' | 'getTreeItem', element?: any): Promise<any> {
        return new Promise((resolve, reject) => {
            const requestId = Math.random().toString(36).substring(7);
            this.pendingDataRequests.set(requestId, { resolve, reject });

            const msg: WorkerMessage = {
                type: 'TREE_VIEW_REQUEST',
                payload: { requestId, viewId, action, element }
            };
            this.worker.postMessage(msg);
        });
    }

    private async handleMessage(e: MessageEvent<MainMessage>) {
        const { type, payload } = e.data;

        switch (type) {
            case 'LOG':
                console.log(`[Worker] ${payload.message}`);
                break;

            case 'REGISTER_COMMAND_PROXY':
                registry.registerCommand(payload.id, (args) => {
                    const msg: WorkerMessage = {
                        type: 'EXEC_COMMAND',
                        payload: { id: payload.id, args }
                    };
                    this.worker.postMessage(msg);
                });
                break;

            case 'API_REQUEST':
                await this.handleApiRequest(payload);
                break;
            
            // [PHASE 2]
            case 'TREE_VIEW_REGISTER':
                console.log(`[WorkerClient] View registered: ${payload.viewId} (Plugin: ${payload.pluginId})`);
                break;

            case 'TREE_VIEW_RESPONSE': {
                const { requestId, data, error } = payload as TreeViewResponsePayload;
                const req = this.pendingDataRequests.get(requestId);
                if (req) {
                    if (error) req.reject(new Error(error));
                    else req.resolve(data);
                    this.pendingDataRequests.delete(requestId);
                }
                break;
            }

            // [NEW] Topbar Registration
            case 'REGISTER_TOPBAR_ITEM': {
                const { id, pluginId, options } = payload as RegisterTopbarItemPayload;
                
                registry.registerTopbarItem({
                    ...options,
                    pluginId,
                    // Bridge events back to worker
                    onClick: () => {
                        const msg: WorkerMessage = {
                            type: 'TOPBAR_ITEM_EVENT',
                            payload: { id, type: 'onClick' }
                        };
                        this.worker.postMessage(msg);
                    },
                    onChange: (val: string) => {
                        const msg: WorkerMessage = {
                            type: 'TOPBAR_ITEM_EVENT',
                            payload: { id, type: 'onChange', value: val }
                        };
                        this.worker.postMessage(msg);
                    }
                });
                break;
            }

            case 'UPDATE_TOPBAR_ITEM': {
                const { id, options } = payload as UpdateTopbarItemPayload;
                registry.updateTopbarItem(id, options);
                break;
            }

            // [PHASE 4] Bridge Events: Worker -> Registry
            case 'EMIT_EVENT': {
                const { event, data } = payload as EventPayload;
                registry.emit(event, data);
                break;
            }

            // [PHASE 3] Dynamic Block Registration
            case 'REGISTER_BLOCK_PROXY': {
                const { type: blockType, initialHtml, pluginId } = payload as RegisterBlockProxyPayload;
                
                console.log(`[WorkerClient] Creating dynamic block '${blockType}' for ${pluginId}`);

                // Dynamically create the Tiptap Node
                const DynamicWorkerNode = Node.create({
                    name: blockType,
                    group: 'block',
                    atom: true,

                    addAttributes() {
                        return {
                            instanceId: { default: null },
                            // Store arbitrary data from worker
                            state: { default: {} }
                        };
                    },

                    addOptions() {
                        return {
                            initialHtml,
                            pluginId
                        }
                    },

                    parseHTML() {
                        return [{ tag: `worker-block[type="${blockType}"]` }];
                    },

                    renderHTML({ HTMLAttributes }) {
                        return [`worker-block`, mergeAttributes(HTMLAttributes, { type: blockType })];
                    },

                    addNodeView() {
                        return ReactNodeViewRenderer(WorkerNodeView);
                    }
                });

                // Register with Host API (which should push to Editor)
                // Note: HostAPIImpl needs to handle live registration if possible, 
                // or this takes effect on next reload.
                this.api.editor.registerExtension(DynamicWorkerNode, { priority: 'normal' });
                break;
            }

            // [PHASE 4] Instance Messaging: Worker -> UI
            case 'BLOCK_INSTANCE_EVENT': {
                const { instanceId, event, data } = payload as BlockInstanceEventPayload;
                // Dispatch to specific UI component via registry channel
                registry.emit(`worker-block-msg:${instanceId}`, { event, data });
                break;
            }
        }
    }

    private async handleApiRequest(req: any) {
        const { requestId, module, method, args, pluginId } = req;
        const response: ApiResponsePayload = {
            requestId,
            success: true,
            data: undefined,
            error: undefined
        };

        try {
            // Route request to actual HostAPI
            let result;
            if (module === 'data.fs') {
                // @ts-ignore
                result = await this.api.data.fs[method](...args);
            } else if (module === 'ui') {
                 // @ts-ignore
                result = this.api.ui[method](...args);
            } else if (module === 'commands') {
                 // @ts-ignore
                result = this.api.commands[method](...args);
            } else if (module === 'plugins') {
                // @ts-ignore
                result = await this.api.plugins[method](...args);
            } else if (module === 'editor') {
                // @ts-ignore
                result = this.api.editor[method](...args);
            } else {
                throw new Error(`Module ${module} not accessible from worker`);
            }
            response.data = result;
        } catch (e: any) {
            response.success = false;
            response.error = e.toString();
        }

        const msg: WorkerMessage = {
            type: 'API_RESPONSE',
            payload: response
        };
        this.worker.postMessage(msg);
    }

    terminate() {
        this.worker.terminate();
    }
}