import React, { useEffect, useRef } from "react";
import { registry } from "../mod-engine/Registry";

interface WebviewContainerProps {
  id: string;
  html: string;
  visible: boolean;
}

export const WebviewContainer: React.FC<WebviewContainerProps> = ({ id, html, visible }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // 1. Inject the "VSCode API" bridge into the HTML
  // This allows the plugin's HTML to call vscode.postMessage()
  const processedHtml = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <script>
        // The Bridge
        const vscode = {
            postMessage: (msg) => {
                window.parent.postMessage({ type: 'webview-msg', id: '${id}', payload: msg }, '*');
            }
        };
        // Expose standard API function
        window.acquireVsCodeApi = () => vscode;

        // Listen for messages from Host
        window.addEventListener('message', (event) => {
            // We expect data to be just the payload from the plugin
            const eventData = event.data;
            // Dispatch a custom event or let the user code handle 'message'
            // For simplicity, we just pass it through.
        });
      </script>
      <style>
        body { background-color: #1e1e2e; color: #cdd6f4; font-family: sans-serif; margin: 0; padding: 20px; }
      </style>
    </head>
    <body>
      ${html}
    </body>
    </html>
  `;

  // 2. Handle Messages: Host -> Iframe
  useEffect(() => {
    const handlePluginMessage = (data: any) => {
        // This event comes from the Event Bus (triggered by Worker -> Registry -> EventBus)
        if (data.targetWebviewId === id && iframeRef.current && iframeRef.current.contentWindow) {
            iframeRef.current.contentWindow.postMessage(data.message, '*');
        }
    };

    // Subscribe to specific event channel for this webview
    const disposable = registry.on(`webview:post-message:${id}`, handlePluginMessage);
    return () => disposable.dispose();
  }, [id]);

  // 3. Handle Messages: Iframe -> Host (Worker)
  useEffect(() => {
    const handleIframeMessage = (event: MessageEvent) => {
        if (event.data && event.data.type === 'webview-msg' && event.data.id === id) {
            // Forward to Registry Event Bus -> Worker Bridge
            registry.emit(`webview:received-message:${id}`, event.data.payload);
        }
    };

    window.addEventListener('message', handleIframeMessage);
    return () => window.removeEventListener('message', handleIframeMessage);
  }, [id]);

  if (!visible) return null;

  return (
    <div className="webview-wrapper" style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', background: '#1e1e2e' }}>
       <iframe
          ref={iframeRef}
          title={`webview-${id}`}
          sandbox="allow-scripts allow-forms allow-same-origin"
          style={{ flex: 1, border: 'none', width: '100%', height: '100%' }}
          srcDoc={processedHtml}
       />
    </div>
  );
};