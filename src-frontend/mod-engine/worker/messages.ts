export interface WorkerMessage {
    type: 'LOAD' | 'EXEC_COMMAND' | 'API_RESPONSE' | 'DEACTIVATE' | 'TREE_VIEW_REQUEST' | 'TOPBAR_ITEM_EVENT' | 'EVENT' | 'REGISTER_WEBVIEW_BLOCK'; 
    payload: any;
}

export interface MainMessage {
    type: 'API_REQUEST' | 'LOG' | 'REGISTER_COMMAND_PROXY' | 'TREE_VIEW_REGISTER' | 'TREE_VIEW_RESPONSE' | 'REGISTER_TOPBAR_ITEM' | 'UPDATE_TOPBAR_ITEM' | 'EMIT_EVENT';
    payload: any;
}

// Payload details
export interface LoadPayload {
    pluginId: string;
    code: string;
    manifest: any;
}

export interface ApiRequestPayload {
    requestId: string;
    module: string; // e.g., 'data.fs'
    method: string; // e.g., 'readFile'
    args: any[];
    pluginId: string;
}

export interface ApiResponsePayload {
    requestId: string;
    success: boolean;
    data?: any;
    error?: string;
}

// [PHASE 2] Tree View Protocols
export interface TreeViewRegisterPayload {
    viewId: string;
    pluginId: string;
}

export interface TreeViewRequestPayload {
    requestId: string;
    viewId: string;
    action: 'getChildren' | 'getTreeItem';
    element?: any; // The generic T, must be JSON serializable
}

export interface TreeViewResponsePayload {
    requestId: string;
    data?: any; // TreeItem or T[]
    error?: string;
}

// [NEW] Topbar Payloads
export interface RegisterTopbarItemPayload {
    id: string; // The item's internal ID
    pluginId: string;
    options: any; // TopbarItemOptions
}

export interface UpdateTopbarItemPayload {
    id: string;
    options: any; // Partial<TopbarItemOptions>
}

export interface TopbarItemEventPayload {
    id: string;
    type: 'onClick' | 'onChange';
    value?: string;
}

// [PHASE 4] Event Bus Payloads
export interface EventPayload {
    event: string;
    data: any;
}

export interface RegisterWebviewBlockPayload {
    id: string;
    options: {
        initialHtml: string;
        initialScript?: string;
        attributes?: Record<string, any>;
    };
    pluginId: string;
}