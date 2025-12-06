import { EventEmitter } from "../../services/EventEmitter";
import { Disposable } from "../types";

export class PluginEventBus extends EventEmitter {
    private globalListeners: ((event: string, data: any) => void)[] = [];

    /**
     * Listen to ALL events (used by WorkerBridge/Debuggers)
     */
    subscribeToAll(handler: (event: string, data: any) => void): Disposable {
        this.globalListeners.push(handler);
        return {
            dispose: () => {
                this.globalListeners = this.globalListeners.filter(h => h !== handler);
            }
        };
    }

    /**
     * Emit an event to specific listeners and global subscribers
     */
    emit(event: string, data?: any) {
        // 1. Notify specific listeners (handled by super)
        super.emit(event, data);

        // 2. Notify global listeners
        this.globalListeners.forEach(h => {
            try { h(event, data); } 
            catch(e) { console.error(`Error in global event handler for ${event}:`, e); }
        });
    }
}

export const pluginEventBus = new PluginEventBus();