// src-frontend/hooks/useCollaborativeEditor.ts
import { useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import { Markdown } from "@tiptap/markdown";
import BubbleMenuExtension from "@tiptap/extension-bubble-menu"; 
import * as Y from "yjs";
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

import { registry } from "../mod-engine/Registry";
import "../mods/SimulationBlock"; 

export function useCollaborativeEditor(
  doc: Y.Doc, 
  channelId: string,
  initialContent: string | null,
  suppressBroadcastRef?: React.MutableRefObject<boolean>
) {
  
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ 
        // @ts-ignore
        history: false 
      }),
      Collaboration.configure({ document: doc }), 
      Markdown,
      BubbleMenuExtension,
      ...registry.getExtensions()
    ],
    editorProps: { attributes: { class: "editor-content" } },
    onCreate: ({ editor }) => {
      // If we have initial content and the collaborative document is empty, set it.
      if (initialContent && editor.isEmpty) {
         editor.commands.setContent(initialContent);
      }
    }
  }, [doc]);

  // Broadcast updates
  useEffect(() => {
    if (!channelId || !doc) return;

    const handleUpdate = (update: Uint8Array, origin: any) => {
      if (origin === 'p2p') return;
      if (suppressBroadcastRef?.current) return;

      invoke("broadcast_update", { 
        path: channelId, 
        data: Array.from(update) 
      }).catch((e) => console.error("Broadcast failed", e));
    };
    
    doc.on("update", handleUpdate);
    return () => {
      doc.off("update", handleUpdate);
    };
  }, [doc, channelId, suppressBroadcastRef]);

  return { editor };
}