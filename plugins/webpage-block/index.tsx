import React, { useState, useEffect } from "react";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { Node, mergeAttributes } from "@tiptap/core";

const WebpageComponent = (props: any) => {
  const [url, setUrl] = useState(props.node.attrs.url);
  const [height, setHeight] = useState(props.node.attrs.height);

  // Sync state if remote users update the attributes
  useEffect(() => {
    if (props.node.attrs.url !== url) {
      setUrl(props.node.attrs.url);
    }
    if (props.node.attrs.height !== height) {
      setHeight(props.node.attrs.height);
    }
  }, [props.node.attrs.url, props.node.attrs.height]);

  // --- URL Handlers ---
  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUrl(e.target.value);
  };

  const commitUrl = () => {
    if (url !== props.node.attrs.url) {
      props.updateAttributes({ url });
    }
  };

  const handleUrlKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      commitUrl();
    }
  };

  // --- Height Handlers ---
  const handleHeightChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setHeight(e.target.value);
  };

  const commitHeight = () => {
    if (height !== props.node.attrs.height) {
      props.updateAttributes({ height });
    }
  };

  const handleHeightKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      commitHeight();
    }
  };

  const openInBrowser = () => {
    if (url) {
        window.open(url, '_blank');
    }
  };

  return (
    <NodeViewWrapper className="webpage-block" style={{
        border: '1px solid #45475a',
        borderRadius: '6px',
        background: '#181825',
        margin: '1rem 0',
        overflow: 'hidden'
    }}>
      {/* Control Bar */}
      <div className="block-header" contentEditable={false} style={{
          background: '#313244',
          padding: '5px 10px',
          display: 'flex',
          gap: '8px',
          alignItems: 'center',
          color: '#a6adc8',
          fontSize: '0.8rem'
      }}>
        <span>🌍</span>
        
        {/* URL Input */}
        <input 
            type="text" 
            value={url} 
            onChange={handleUrlChange} 
            onKeyDown={handleUrlKeyDown}
            onBlur={commitUrl}
            placeholder="Enter URL (e.g. https://www.youtube.com/embed/...)"
            style={{
                flex: 1,
                background: '#11111b',
                border: '1px solid #45475a',
                color: '#cdd6f4',
                padding: '4px 8px',
                borderRadius: '4px',
                fontSize: '0.8rem'
            }}
        />

        {/* Height Input */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }} title="Block Height">
            <span style={{ fontSize: '0.8rem', opacity: 0.7 }}>H:</span>
            <input 
                type="text" 
                value={height} 
                onChange={handleHeightChange} 
                onKeyDown={handleHeightKeyDown}
                onBlur={commitHeight}
                style={{
                    width: '60px',
                    background: '#11111b',
                    border: '1px solid #45475a',
                    color: '#cdd6f4',
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontSize: '0.8rem',
                    textAlign: 'center'
                }}
            />
        </div>

        <button 
            onClick={openInBrowser}
            title="Open in System Browser"
            style={{
                background: 'transparent',
                border: '1px solid #585b70',
                color: '#89b4fa',
                cursor: 'pointer',
                borderRadius: '4px',
                padding: '2px 8px',
                fontSize: '0.8rem'
            }}
        >
            ↗
        </button>
      </div>

      {/* Webpage Content */}
      <div className="webpage-content" contentEditable={false} style={{
          height: height, // Use dynamic height
          background: '#11111b',
          position: 'relative',
          transition: 'height 0.2s ease'
      }}>
        {props.node.attrs.url ? (
            <iframe 
                src={props.node.attrs.url} 
                style={{ width: '100%', height: '100%', border: 'none' }}
                title="Embed"
                sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-presentation"
                allowFullScreen
            />
        ) : (
            <div style={{ 
                height: '100%', display: 'flex', flexDirection: 'column', 
                alignItems: 'center', justifyContent: 'center', color: '#585b70',
                gap: '10px'
            }}>
                <div>Enter a URL above to load content.</div>
                <small style={{ opacity: 0.6 }}>
                    Note: Sites like Google or YouTube (Watch) may refuse to load.<br/>
                    Use Embed URLs (e.g. youtube.com/embed/...) where possible.
                </small>
            </div>
        )}
      </div>
    </NodeViewWrapper>
  );
};

const WebpageNode = Node.create({
  name: 'webpageBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      url: { default: '' },
      height: { default: '400px' }, // Added synced height attribute
    };
  },

  parseHTML() {
    return [{ tag: 'webpage-block' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['webpage-block', mergeAttributes(HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(WebpageComponent);
  },
});

export function activate(context: any) {
  context.editor.registerExtension(WebpageNode);
  context.commands.registerCommand("webpage.insert", (args: any) => {
    const editor = context.editor.getSafeInstance();
    if (editor) {
      if (args && args.range) {
          editor.chain().focus().insertContentAt(args.range, { type: 'webpageBlock' }).run();
      } else {
          editor.chain().focus().insertContent({ type: 'webpageBlock' }).run();
      }
    }
  });
}

export function deactivate() {}