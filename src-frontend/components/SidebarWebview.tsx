import React, { useEffect, useRef } from "react";
import { WebviewViewOptions } from "../mod-engine/types";
import { registry } from "../mod-engine/Registry";

interface SidebarWebviewProps {
    viewId: string;
    options: WebviewViewOptions;
}

export const SidebarWebview: React.FC<SidebarWebviewProps> = ({ viewId, options }) => {
    const iframeRef = useRef<HTMLIFrameElement>(null);

    useEffect(() => {
        const iframe = iframeRef.current;
        if (!iframe) return;

        // --- 1. Outbound Bridge: Host -> Webview ---
        // Subscribe to global registry events and forward them to the iframe.
        // We capture the 'Disposable' object returned by subscribeToAll.
        const subscription = registry.subscribeToAll((event, data) => {
            if (iframe.contentWindow) {
                iframe.contentWindow.postMessage({
                    type: 'event',
                    channel: event,
                    data: data
                }, '*');
            }
        });

        // --- 2. Inbound Bridge: Webview -> Host ---
        const handleMessage = (e: MessageEvent) => {
            // Security/Context Check
            if (e.source !== iframe.contentWindow) return;

            const msg = e.data;
            if (!msg || typeof msg !== 'object') return;

            if (msg.command === 'executeCommand') {
                registry.executeCommand(msg.id, msg.args);
            }
        };

        window.addEventListener('message', handleMessage);

        // --- 3. Initialize Webview Content ---
        if (options.entryPoint && options.pluginId) {
            iframe.src = `plugin://${options.pluginId}/${options.entryPoint}`;
        } else if (options.initialHtml) {
            const docContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { margin: 0; padding: 0; background: transparent; color: #cdd6f4; font-family: sans-serif; }
          </style>
        </head>
        <body>
          ${options.initialHtml}
          <script>
            window.viewId = '${viewId}';
            ${options.initialScript || ''}
          </script>
        </body>
        </html>
      `;
            iframe.srcdoc = docContent;
        }

        // Cleanup
        return () => {
            subscription.dispose();
            window.removeEventListener('message', handleMessage);
        };
    }, [viewId, options]);

    return (
        <div className="sidebar-webview" style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
            <iframe
                ref={iframeRef}
                style={{ flex: 1, width: '100%', border: 'none', background: '#1e1e2e' }}
                title={options.title || "Webview"}
                sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
            />
        </div>
    );
};