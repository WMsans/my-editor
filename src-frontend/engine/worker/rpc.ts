export interface RPCMessage {
    type: 'RPC_REQ' | 'RPC_RES';
    reqId: string;
    method?: string;   // Only for REQ
    payload?: any;     // Args for REQ
    data?: any;        // Result for RES
    error?: string;    // Error for RES
}

export type RPCHandler = (payload: any) => Promise<any> | any;

export class RPCManager {
  private handlers = new Map<string, RPCHandler>();
  private pendingRequests = new Map<string, { resolve: Function, reject: Function }>();

  constructor(private postMessageFn: (msg: RPCMessage) => void) {}

  /**
   * Register a method that the other side can call.
   */
  register(method: string, handler: RPCHandler) {
    this.handlers.set(method, handler);
  }

  /**
   * Call a method on the other side.
   */
  request<T = any>(method: string, payload?: any): Promise<T> {
    const reqId = Math.random().toString(36).substring(2, 10);
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(reqId, { resolve, reject });
      this.postMessageFn({ type: 'RPC_REQ', reqId, method, payload });
    });
  }

  /**
   * Handle incoming messages (must be wired to onmessage).
   */
  handleMessage(data: any) {
    if (!data || typeof data !== 'object') return;

    if (data.type === 'RPC_REQ') {
        const { reqId, method, payload } = data as RPCMessage;
        if (!method) return;

        const handler = this.handlers.get(method);
        if (!handler) {
            this.postMessageFn({ type: 'RPC_RES', reqId, error: `Method '${method}' not found` });
            return;
        }

        Promise.resolve(handler(payload))
            .then(result => this.postMessageFn({ type: 'RPC_RES', reqId, data: result }))
            .catch(err => this.postMessageFn({ type: 'RPC_RES', reqId, error: err.toString() }));
            
    } else if (data.type === 'RPC_RES') {
        const { reqId, data: result, error } = data as RPCMessage;
        const pending = this.pendingRequests.get(reqId);
        if (pending) {
            if (error) pending.reject(new Error(error));
            else pending.resolve(result);
            this.pendingRequests.delete(reqId);
        }
    }
  }
}