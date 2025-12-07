import React, { useEffect, useState } from "react";
import { EditorContent, Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { SlashMenu } from "./SlashMenu";
import { registry } from "../../../engine/registry/Registry";
import { commandService } from "../../../engine/api/CommandService";

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
  // Subscribe to registry bubble items
  const [bubbleItems, setBubbleItems] = useState(registry.getBubbleItems());

  useEffect(() => {
    // Initial fetch
    setBubbleItems([...registry.getBubbleItems()]);

    // Listen
    const unsub = registry.subscribe(() => {
      setBubbleItems([...registry.getBubbleItems()]);
    });
    return unsub;
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

      <div className="editor-scroll-area">
        {editor && <SlashMenu editor={editor} />}

        {editor && (
          <BubbleMenu className="bubble-menu" editor={editor}>
            <button 
              onClick={() => editor.chain().focus().toggleBold().run()} 
              className={editor.isActive('bold') ? 'is-active' : ''}
              title="Bold"
            >
              𝐁
            </button>
            <button 
              onClick={() => editor.chain().focus().toggleItalic().run()} 
              className={editor.isActive('italic') ? 'is-active' : ''}
              title="Italic"
            >
              𝐼
            </button>
            <button 
              onClick={() => editor.chain().focus().toggleCode().run()} 
              className={editor.isActive('code') ? 'is-active' : ''}
              title="Code"
            >
              {'</>'}
            </button>
            
            {/* Dynamic Plugin Items */}
            {bubbleItems.map(item => (
              <button
                key={item.id}
                onClick={() => commandService.executeCommand(item.command)}
                title={item.tooltip}
              >
                {item.icon}
              </button>
            ))}
          </BubbleMenu>
        )}
        <EditorContent editor={editor} />
      </div>
      
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