import { useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import { Markdown } from "@tiptap/markdown";
import BubbleMenuExtension from "@tiptap/extension-bubble-menu"; // Import the extension
import * as Y from "yjs";
import { useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";

export function useCollaborativeEditor() {
  const ydoc = useMemo(() => new Y.Doc(), []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ 
        // @ts-ignore
        history: false 
    }),
      Collaboration.configure({ document: ydoc }),
      Markdown,
      BubbleMenuExtension, // Register the extension here
    ],
    editorProps: { attributes: { class: "editor-content" } },
  });

  // Broadcast updates
  useEffect(() => {
    const handleUpdate = (update: Uint8Array) => {
      invoke("broadcast_update", { data: Array.from(update) })
        .catch((e) => console.error("Broadcast failed", e));
    };
    ydoc.on("update", handleUpdate);
    return () => {
      ydoc.off("update", handleUpdate);
    };
  }, [ydoc]);

  return { editor, ydoc };
}