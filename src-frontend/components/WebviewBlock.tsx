import React, { useEffect, useRef, useState } from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";

interface WebviewBlockOptions {
  id: string;
  initialHtml?: string;
  initialScript?: string;
  entryPoint?: string;
  pluginId?: string;
  attributes?: Record<string, any>;
}

const WebviewBlockComponent = (props: any) => {
  const { initialHtml, initialScript, entryPoint, pluginId } = props.extension.options.webviewOptions;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  
  // Track resizing state to disable iframe pointer events during drag
  const [isResizing, setIsResizing] = useState(false);

  // Helper to safely parse height from attributes
  const parseHeight = (h: any) => {
      if (typeof h === 'number') return h;
      if (typeof h === 'string') {
          const parsed = parseInt(h, 10);
          return isNaN(parsed) ? 400 : parsed;
      }
      return 400;
  };

  const [height, setHeight] = useState(parseHeight(props.node.attrs.height));
  const heightRef = useRef(height);

  useEffect(() => {
    const h = parseHeight(props.node.attrs.height);
    setHeight(h);
    heightRef.current = h;
  }, [props.node.attrs.height]);

  const attrs = JSON.stringify(props.node.attrs);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    if (entryPoint && pluginId) {
        iframe.src = `plugin://${pluginId}/${entryPoint}`;
    } 
    else if (initialHtml) {
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
            window.updateAttributes = (newAttrs) => {
              window.parent.postMessage({ type: 'UPDATE_ATTRS', nodeId: '${props.node.attrs.id}', attrs: newAttrs }, '*');
            };
            window.initialAttrs = ${attrs};
            ${initialScript || ''}
          </script>
        </body>
        </html>
      `;
      iframe.srcdoc = docContent;
    }
  }, []); 

  const syncAttrs = () => {
    const iframe = iframeRef.current;
    if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ 
            type: 'SYNC_ATTRS', 
            attrs: props.node.attrs 
        }, '*');
    }
  };

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
    syncAttrs();
  }, [props.node.attrs]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true); // Disable pointer events on iframe
    const startY = e.clientY;
    const startHeight = heightRef.current;

    const onMouseMove = (moveEvent: MouseEvent) => {
        const currentY = moveEvent.clientY;
        const diff = currentY - startY;
        const newHeight = Math.max(150, startHeight + diff);
        
        setHeight(newHeight);
        heightRef.current = newHeight;
    };

    const onMouseUp = () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        setIsResizing(false); // Re-enable pointer events
        props.updateAttributes({ height: heightRef.current });
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  return (
    <NodeViewWrapper className="webview-block" style={{ 
        border: '1px solid #45475a', 
        borderRadius: '6px', 
        overflow: 'hidden', 
        background: '#181825', 
        display: 'flex', 
        flexDirection: 'column' 
    }}>
      <iframe 
        ref={iframeRef}
        onLoad={syncAttrs}
        style={{ 
            width: '100%', 
            height: `${height}px`, 
            border: 'none', 
            display: 'block',
            // Fix: Disable pointer events during drag so mouse doesn't get "stuck" in iframe
            pointerEvents: isResizing ? 'none' : 'auto'
        }} 
        title="Webview Block"
        sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
      />
      <div 
        onMouseDown={handleMouseDown}
        style={{
            height: '12px',
            background: '#11111b',
            borderTop: '1px solid #313244',
            cursor: 'ns-resize',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'background 0.2s',
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = '#313244'}
        onMouseLeave={(e) => e.currentTarget.style.background = '#11111b'}
      >
        <div style={{ width: '40px', height: '4px', borderRadius: '2px', background: '#45475a' }}></div>
      </div>
    </NodeViewWrapper>
  );
};

export const createWebviewBlockExtension = (options: WebviewBlockOptions) => {
  return Node.create({
    name: options.id,
    group: 'block',
    atom: true,

    addAttributes() {
      return {
        id: {
            default: () => Math.random().toString(36).substr(2, 9),
        },
        height: {
            default: 400,
            parseHTML: element => element.getAttribute('height'),
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
    
    addOptions() {
      return {
        webviewOptions: options,
      };
    },
  });
};