import React, { useEffect, useState } from "react";
import { EditorContent, Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { SlashMenu } from "./SlashMenu";
import { registry } from "../mod-engine/Registry";
import { WebviewContainer } from "./WebviewContainer";

interface EditorAreaProps {
  editor: Editor | null;
  isJoining: boolean;
  isPushing: boolean;
  isSyncing: boolean;
}

export const EditorArea: React.FC<EditorAreaProps> = ({ 
  editor, 
  isJoining, 
  isPushing, 
  isSyncing 
}) => {
  // [PHASE 5] Webview State
  const [activeWebview, setActiveWebview] = useState<{id: string, html: string, title: string} | null>(null);

  useEffect(() => {
    // Check initial state
    const current = registry.getActiveWebview();
    if (current) setActiveWebview({ ...current });

    // Subscribe to registry changes
    const unsubscribe = registry.subscribe(() => {
        const wv = registry.getActiveWebview();
        if (wv) {
            setActiveWebview({ ...wv });
        } else {
            setActiveWebview(null);
        }
    });
    return unsubscribe;
  }, []);
  return (
    <main className="editor-container">
      {(isSyncing || isPushing) && (
        <div className="loading-overlay">
          <div className="loading-content">
            <div className="loading-text">
              {isPushing ? "Pushing changes to remote..." : "Syncing content..."}
            </div>
            {isPushing && <small>Please wait, do not close.</small>}
          </div>
        </div>
      )}
      {activeWebview ? (
          <div className="webview-layer" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
              <div className="webview-header" style={{ padding: '8px 16px', background: '#181825', borderBottom: '1px solid #313244', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{activeWebview.title.toUpperCase()}</span>
                  <button onClick={() => registry.disposeWebview(activeWebview.id)} style={{background: 'none', border:'none', color:'#f38ba8', cursor:'pointer'}}>Close</button>
              </div>
              <WebviewContainer 
                  id={activeWebview.id} 
                  html={activeWebview.html} 
                  visible={true} 
              />
          </div>
      ) : (
      <div className="editor-scroll-area">
        {editor && <SlashMenu editor={editor} />}

        {editor && (
          <BubbleMenu className="bubble-menu" editor={editor}>
            <button 
              onClick={() => editor.chain().focus().toggleBold().run()} 
              className={editor.isActive('bold') ? 'is-active' : ''}
            >
              Bold
            </button>
            <button 
              onClick={() => editor.chain().focus().toggleItalic().run()} 
              className={editor.isActive('italic') ? 'is-active' : ''}
            >
              Italic
            </button>
            <button 
              onClick={() => editor.chain().focus().toggleCode().run()} 
              className={editor.isActive('code') ? 'is-active' : ''}
            >
              Code
            </button>
          </BubbleMenu>
        )}
        <EditorContent editor={editor} />
      </div>
      )}
      {/* Add specific CSS for the loading overlay here or in App.css */}
      <style>{`
        .loading-overlay {
          position: absolute; top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(30, 30, 46, 0.8); color: #cdd6f4;
          z-index: 9999; display: flex; align-items: center; 
          justify-content: center; flex-direction: column;
        }
        .loading-text { font-size: 1.2rem; margin-bottom: 10px; }
      `}</style>
    </main>
  );
};