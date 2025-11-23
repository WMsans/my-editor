// src-frontend/hooks/useCollaborativeEditor.ts
import { useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import { Markdown } from "@tiptap/markdown";
import BubbleMenuExtension from "@tiptap/extension-bubble-menu"; 
import * as Y from "yjs";
import { useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Extension } from "@tiptap/core"; 

import { registry } from "../mod-engine/Registry";
import "../mods/SimulationBlock"; 

// UPDATED: Handle Enter key intelligently
const MultiLineEnter = Extension.create({
  name: 'multiLineEnter',
  addKeyboardShortcuts() {
    return {
      'Enter': () => {
        const { state } = this.editor;
        // Check if the cursor is currently inside a Heading
        if (state.selection.$head.parent.type.name === 'heading') {
          // If in a heading, split the block and force the new line to be a Paragraph (Normal Text)
          return this.editor.chain()
            .splitBlock()
            .setNode('paragraph')
            .run();
        }
        // Standard behavior: Enter creates a new paragraph (Split Block)
        return this.editor.commands.splitBlock();
      },
      // REMOVED: 'Shift-Enter' binding. 
      // We let the default Tiptap HardBreak extension handle 'Shift-Enter' (creates a line break <br>).
    }
  }
});

// UPDATED: Support multiple heading levels (h1-h6)
// Works at start of block (Normal Enter) OR after a soft break (Shift+Enter)
const HeadingWithSplit = Extension.create({
  name: 'headingWithSplit',
  addKeyboardShortcuts() {
    return {
      ' ': () => {
        const { state } = this.editor;
        const { selection } = state;
        const { $from } = selection;
        
        const parent = $from.parent;
        // Get text before cursor; \uFFFC is the placeholder for HardBreak
        const textBefore = parent.textBetween(0, $from.parentOffset, '\n', '\uFFFC');

        // Regex: Matches Start of Block (^) OR HardBreak (\uFFFC) followed by 1 to 6 hashes (#)
        const match = textBefore.match(/(?:^|(\uFFFC))(#{1,6})$/);

        if (match) {
          const marker = match[1]; // Will be \uFFFC if found, or undefined if Start of Block
          const hashes = match[2]; 
          const level = hashes.length as 1 | 2 | 3 | 4 | 5 | 6;
          
          let chain = this.editor.chain();

          if (marker) {
             // Case 1: After a Hard Break (delete marker + hashes, then split)
             // This handles the "Shift+Enter" -> "##" -> Space case
             chain = chain
               .deleteRange({ from: $from.pos - hashes.length - 1, to: $from.pos }) 
               .splitBlock();
          } else {
             // Case 2: Start of Block (just delete hashes, convert current block)
             // This handles the "Enter" -> "##" -> Space case
             chain = chain
               .deleteRange({ from: $from.pos - hashes.length, to: $from.pos });
          }

          return chain
            .setNode("heading", { level })
            .run();
        }
        
        // Allow default Space behavior if no match
        return false; 
      }
    }
  }
});

export function useCollaborativeEditor(currentFilePath: string | null, channelId: string | null) {
  
  const ydoc = useMemo(() => new Y.Doc(), [currentFilePath]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ 
        // @ts-ignore
        history: false 
      }),
      MultiLineEnter,
      HeadingWithSplit, 
      Collaboration.configure({ document: ydoc }),
      Markdown,
      BubbleMenuExtension,
      ...registry.getExtensions()
    ],
    editorProps: { attributes: { class: "editor-content" } },
  }, [currentFilePath, ydoc]); 

  useEffect(() => {
    if (!channelId) return;

    const handleUpdate = (update: Uint8Array) => {
      invoke("broadcast_update", { 
        path: channelId, 
        data: Array.from(update) 
      }).catch((e) => console.error("Broadcast failed", e));
    };
    
    ydoc.on("update", handleUpdate);
    return () => {
      ydoc.off("update", handleUpdate);
    };
  }, [ydoc, channelId]);

  return { editor, ydoc };
}