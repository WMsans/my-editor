import React, { useEffect, useRef, useState } from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";

interface WebviewBlockOptions {
  id: string;
  initialHtml: string;
  initialScript?: string;
  attributes?: Record<string, any>;
}

const WebviewBlockComponent = (props: any) => {
  const { initialHtml, initialScript } = props.extension.options.webviewOptions;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  
  // Serialize attributes to pass to the iframe
  const attrs = JSON.stringify(props.node.attrs);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (iframe) {
      // Construct the document to be loaded in the iframe
      const docContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { margin: 0; padding: 0; background: transparent; color: #cdd6f4; font-family: sans-serif; }
          </style>
        </head>
        <body>
          ${initialHtml}
          <script>
            // Simple bridge to the parent
            window.updateAttributes = (newAttrs) => {
              window.parent.postMessage({ type: 'UPDATE_ATTRS', nodeId: '${props.node.attrs.id}', attrs: newAttrs }, '*');
            };
            
            // Initialize with current attributes
            window.initialAttrs = ${attrs};
            
            ${initialScript || ''}
          </script>
        </body>
        </html>
      `;
      iframe.srcdoc = docContent;
    }
  }, []); // Run once on mount

  // Listen for updates from the iframe (e.g., if the iframe wants to update node attributes)
  useEffect(() => {
    const handler = (e: MessageEvent) => {
       if (e.data?.type === 'UPDATE_ATTRS' && e.data?.nodeId === props.node.attrs.id) {
           props.updateAttributes(e.data.attrs);
       }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [props.node.attrs.id]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ 
            type: 'SYNC_ATTRS', 
            attrs: props.node.attrs 
        }, '*');
    }
  }, [props.node.attrs]); 

  return (
    <NodeViewWrapper className="webview-block" style={{ border: '1px solid #45475a', borderRadius: '6px', overflow: 'hidden', background: '#181825' }}>
      <iframe 
        ref={iframeRef}
        style={{ width: '100%', height: '250px', border: 'none' }} 
        title="Webview Block"
      />
    </NodeViewWrapper>
  );
};

export const createWebviewBlockExtension = (options: WebviewBlockOptions) => {
  return Node.create({
    name: options.id,
    group: 'block',
    atom: true,

    addAttributes() {
      // Merge custom attributes with a default 'id' for message routing
      return {
        id: {
            default: () => Math.random().toString(36).substr(2, 9),
        },
        ...options.attributes
      };
    },

    parseHTML() {
      return [{ tag: options.id }];
    },

    renderHTML({ HTMLAttributes }) {
      return [options.id, mergeAttributes(HTMLAttributes)];
    },

    addNodeView() {
      return ReactNodeViewRenderer(WebviewBlockComponent);
    },
    
    // Attach options to the extension instance for the component to access
    addOptions() {
      return {
        webviewOptions: options,
      };
    },
  });
};