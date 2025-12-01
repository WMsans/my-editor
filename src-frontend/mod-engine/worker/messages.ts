export interface WorkerMessage {
    type: 'LOAD' | 'EXEC_COMMAND' | 'API_RESPONSE' | 'DEACTIVATE'; 
    payload: any;
}

export interface MainMessage {
    type: 'API_REQUEST' | 'LOG' | 'REGISTER_COMMAND_PROXY';
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