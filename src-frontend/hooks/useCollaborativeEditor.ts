import { useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import { Markdown } from "@tiptap/markdown";
import BubbleMenuExtension from "@tiptap/extension-bubble-menu"; 
import * as Y from "yjs";
import { useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { registry } from "../mod-engine/Registry";
import "../mods/SimulationBlock"; 

// Accept currentFilePath to create unique collaborative sessions per file
export function useCollaborativeEditor(currentFilePath: string | null) {
  // 1. Create a fresh YDoc when the file changes
  const ydoc = useMemo(() => new Y.Doc(), [currentFilePath]);

  // 2. Recreate the editor when the file or ydoc changes
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ 
        // @ts-ignore
        history: false 
      }),
      // Bind Collaboration extension to the specific ydoc for this file
      Collaboration.configure({ document: ydoc }),
      Markdown,
      BubbleMenuExtension,
      ...registry.getExtensions()
    ],
    editorProps: { attributes: { class: "editor-content" } },
  }, [currentFilePath, ydoc]);

  // 3. Broadcast updates with the specific file path
  useEffect(() => {
    if (!currentFilePath) return;

    const handleUpdate = (update: Uint8Array) => {
      invoke("broadcast_update", { 
        path: currentFilePath, 
        data: Array.from(update) 
      }).catch((e) => console.error("Broadcast failed", e));
    };
    
    ydoc.on("update", handleUpdate);
    return () => {
      ydoc.off("update", handleUpdate);
    };
  }, [ydoc, currentFilePath]);

  return { editor, ydoc };
}