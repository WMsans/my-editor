import React, { useEffect, useRef } from "react";
import { WebviewViewOptions } from "../../../engine/types";
import { registry } from "../../../engine/registry/Registry";
import { commandService } from "../../../engine/api/CommandService";

interface SidebarWebviewProps {
    viewId: string;
    options: WebviewViewOptions;
}

export const SidebarWebview: React.FC<SidebarWebviewProps> = ({ viewId, options }) => {
    const iframeRef = useRef<HTMLIFrameElement>(null);

    useEffect(() => {
        const iframe = iframeRef.current;
        if (!iframe) return;

        const subscription = registry.subscribeToAll((event, data) => {
            if (iframe.contentWindow) {
                iframe.contentWindow.postMessage({
                    type: 'event',
                    channel: event,
                    data: data
                }, '*');
            }
        });

        const handleMessage = (e: MessageEvent) => {
            if (e.source !== iframe.contentWindow) return;

            const msg = e.data;
            if (!msg || typeof msg !== 'object') return;

            if (msg.command === 'executeCommand') {
                commandService.executeCommand(msg.id, msg.args);
            }
        };

        window.addEventListener('message', handleMessage);

        if (options.entryPoint && options.pluginId) {
            iframe.src = `plugin://${options.pluginId}/${options.entryPoint}`;
        } else if (options.initialHtml) {
            const docContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { margin: 0; padding: 0; background: transparent; color: var(--text-primary); font-family: sans-serif; }
          </style>
          <script>
            // Sync Theme Variables from Parent
            function syncTheme() {
                try {
                    const p = window.parent.document.documentElement;
                    const s = window.parent.getComputedStyle(p);
                    const vars = [
                        '--bg-primary', '--bg-secondary', '--bg-tertiary',
                        '--text-primary', '--text-secondary', '--text-muted',
                        '--border-color', '--border-hover', '--accent'
                    ];
                    vars.forEach(v => {
                        document.documentElement.style.setProperty(v, s.getPropertyValue(v));
                    });
                } catch(e) { console.warn('Theme sync failed', e); }
            }
            syncTheme();
          </script>
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

        return () => {
            subscription.dispose();
            window.removeEventListener('message', handleMessage);
        };
    }, [viewId, options]);

    return (
        <div className="sidebar-webview" style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
            <iframe
                ref={iframeRef}
                style={{ flex: 1, width: '100%', border: 'none', background: 'var(--bg-primary)' }}
                title={options.title || "Webview"}
                sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
            />
        </div>
    );
};