import { useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import { Markdown } from "@tiptap/markdown";
import BubbleMenuExtension from "@tiptap/extension-bubble-menu"; 
import * as Y from "yjs";
import { useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Extension, InputRule } from "@tiptap/core"; // Added InputRule

import { registry } from "../mod-engine/Registry";
import "../mods/SimulationBlock"; 

const MultiLineEnter = Extension.create({
  name: 'multiLineEnter',
  addKeyboardShortcuts() {
    return {
      'Enter': () => this.editor.commands.setHardBreak(),
      'Shift-Enter': () => this.editor.commands.splitBlock(),
    }
  }
});

// Custom Extension to handle # Space after a hard break
const HeadingWithSplit = Extension.create({
  name: 'headingWithSplit',
  addInputRules() {
    return [
      new InputRule({
        // Matches <HardBreak>#<Space>
        // \uFFFC is the character Tiptap uses for leaf nodes like HardBreak in text pattern matching
        find: /\uFFFC#\s$/,
        handler: ({ state, range }) => {
          const { from, to } = range;
          // 1. Delete the HardBreak (\uFFFC) and the "# " text
          // 2. Split the block at that point
          // 3. Convert the new current block to a Heading (Level 1)
          this.editor.chain()
            .deleteRange({ from, to }) 
            .splitBlock()
            .setNode("heading", { level: 1 })
            .run();
        }
      })
    ]
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
      HeadingWithSplit, // Register the new extension
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