import React, { useEffect, useRef, useState } from "react";
import { NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import { registry } from "../mod-engine/Registry";

interface WorkerNodeViewProps {
  node: any;
  updateAttributes: (attrs: any) => void;
  extension: any;
}

export const WorkerNodeView: React.FC<WorkerNodeViewProps> = ({ node, updateAttributes, extension }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [instanceId] = useState(() => node.attrs.instanceId || Math.random().toString(36).substring(7));
  const { initialHtml, pluginId } = extension.options;

  // 1. Initialize Content
  useEffect(() => {
    if (!node.attrs.instanceId) {
        updateAttributes({ instanceId });
    }
    
    if (containerRef.current && initialHtml) {
        containerRef.current.innerHTML = initialHtml;
        
        // Attach standard event listeners to bridge to worker
        // We capture clicks on elements with 'data-event' attributes
        const handleInteraction = (e: Event) => {
            const target = e.target as HTMLElement;
            if (target && target.dataset.event) {
                const eventName = target.dataset.event;
                // Gather inputs if any
                const inputs: any = {};
                containerRef.current?.querySelectorAll('input, textarea, select').forEach((el: any) => {
                    if (el.id) inputs[el.id] = el.value;
                });

                // Send to Worker via Registry Bus
                registry.emit('worker-block-action', {
                    pluginId,
                    instanceId,
                    event: eventName,
                    data: inputs
                });
            }
        };

        containerRef.current.addEventListener('click', handleInteraction);
        return () => containerRef.current?.removeEventListener('click', handleInteraction);
    }
  }, [initialHtml]);

  // 2. Listen for Worker Messages
  useEffect(() => {
      const channel = `worker-block-msg:${instanceId}`;
      const listener = registry.on(channel, (payload: any) => {
          const { event, data } = payload;
          
          if (event === 'render' && containerRef.current) {
              // Custom logic: if 'render' event, expect data to be canvas instructions or similar
              // For now, we support a simple 'set-inner-text' or 'custom-eval'
              // In a real implementation, this would be a safe renderer.
              console.log(`[WorkerBlock ${instanceId}] Received render:`, data);
              
              // Example: Find element by ID and update
              if (data && typeof data === 'object') {
                  Object.keys(data).forEach(key => {
                      const el = containerRef.current?.querySelector(`#${key}`);
                      if (el) {
                          if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
                              el.value = data[key];
                          } else {
                              el.innerHTML = data[key];
                          }
                      }
                  });
              }
          }
      });

      return () => listener.dispose();
  }, [instanceId]);

  return (
    <NodeViewWrapper className="worker-block-container" style={{ border: '1px solid #45475a', padding: '10px', borderRadius: '4px', margin: '1em 0' }}>
      <div className="worker-block-header" style={{ fontSize: '0.8em', color: '#a6adc8', marginBottom: '5px' }}>
         🧩 {extension.name}
      </div>
      <div 
        ref={containerRef} 
        className="worker-block-content" 
        contentEditable={false} // Worker blocks are UI islands
      />
    </NodeViewWrapper>
  );
};