import { HostAPI } from "../types";
import { MainMessage, WorkerMessage, ApiResponsePayload } from "./messages";
import { registry } from "../Registry";

export class WorkerClient {
    private worker: Worker;
    private api: HostAPI;

    constructor(api: HostAPI) {
        this.api = api;
        // Vite syntax for worker import
        this.worker = new Worker(new URL('./PluginWorker.ts', import.meta.url), { type: 'module' });
        
        this.worker.onmessage = this.handleMessage.bind(this);
        this.worker.onerror = (e) => console.error("Plugin Worker Error:", e);
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

    private async handleMessage(e: MessageEvent<MainMessage>) {
        const { type, payload } = e.data;

        switch (type) {
            case 'LOG':
                console.log(`[Worker] ${payload.message}`);
                break;

            case 'REGISTER_COMMAND_PROXY':
                // Register a command in the Main registry that forwards to the Worker
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