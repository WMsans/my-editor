import React, { useEffect, useState, useRef } from "react";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { Node, mergeAttributes } from "@tiptap/core";
import { WebviewContainer } from "./WebviewContainer";
import { registry } from "../mod-engine/Registry";

// --- 1. The React Component ---
const WebviewBlockComponent = (props: any) => {
  const { viewType } = props.node.attrs;
  // Use a stable ID for this block instance. 
  // We use the node's internal ID if available, otherwise generate one.
  // Note: TipTap doesn't guarantee UUIDs for nodes unless configured. 
  // We'll generate a random one on mount if needed, but for Collab it's better to store it in attrs.
  
  const [webviewId, setWebviewId] = useState<string | null>(props.node.attrs.webviewId || null);
  const [html, setHtml] = useState("");

  useEffect(() => {
    // 1. Ensure we have an ID
    let id = webviewId;
    if (!id) {
        id = Math.random().toString(36).substring(2, 15);
        setWebviewId(id);
        props.updateAttributes({ webviewId: id });
    }

    // 2. Register this "Virtual" Webview in Registry
    // This allows the standard WebviewContainer logic (postMessage bridge) to work.
    // We pass empty HTML initially.
    registry.registerWebviewPanel(id, `Block: ${viewType}`, "");

    // 3. Subscribe to HTML updates from Registry
    // (The worker will push updates to Registry via WEBVIEW_UPDATE_HTML)
    const unsubscribe = registry.subscribe(() => {
        const wv = registry.getWebview(id!);
        if (wv && wv.html !== html) {
            setHtml(wv.html);
        }
    });

    // 4. Request Resolution from Worker
    // This tells the worker: "Hey, UI created a block of type X with ID Y. Please initialize it."
    registry.resolveWebviewBlock(viewType, id);

    return () => {
        unsubscribe();
        registry.disposeWebview(id!);
    };
  }, []);

  if (!webviewId) return <div>Initializing Block...</div>;

  return (
    <NodeViewWrapper className="webview-block" style={{ border: '1px solid #45475a', borderRadius: '6px', overflow: 'hidden', margin: '1rem 0' }}>
       <div className="block-header" contentEditable={false} style={{ background: '#313244', padding: '5px 10px', fontSize: '0.8rem', color: '#a6adc8', userSelect: 'none' }}>
            <span>📦 {viewType}</span>
       </div>
       <div className="block-content" style={{ height: '300px', resize: 'vertical', overflow: 'hidden' }}>
          <WebviewContainer 
            id={webviewId} 
            html={html} 
            visible={true} 
          />
       </div>
    </NodeViewWrapper>
  );
};

// --- 2. The Tiptap Node Definition ---
export const WebviewBlockNode = Node.create({
  name: 'webviewBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      viewType: { default: 'default' },
      webviewId: { default: null }, // Persist ID for collaboration stability
    };
  },

  parseHTML() {
    return [{ tag: 'webview-block' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['webview-block', mergeAttributes(HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(WebviewBlockComponent);
  },
});