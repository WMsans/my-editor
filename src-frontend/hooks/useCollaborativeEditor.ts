import { useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import { Markdown } from "@tiptap/markdown";
import BubbleMenuExtension from "@tiptap/extension-bubble-menu"; 
import * as Y from "yjs";
import React, { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

import { registry } from "../mod-engine/Registry";
import "../mods/SimulationBlock"; 

export function useCollaborativeEditor(
  ydoc: Y.Doc,
  channelId: string | null,
  suppressBroadcastRef?: React.MutableRefObject<boolean>
) {

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // @ts-ignore
        history: false
      }),
      Collaboration.configure({ document: ydoc }),
      Markdown,
      BubbleMenuExtension,
      ...registry.getExtensions()
    ],
    editorProps: { attributes: { class: "editor-content" } },
  }, [ydoc]);

  // Broadcast updates using the RELATIVE path (channelId)
  useEffect(() => {
    if (!channelId) return;

    // Check the 'origin' of the update
    const handleUpdate = (update: Uint8Array, origin: any) => {
      // FIX: If the update came from 'p2p' (applied by useP2P), do NOT broadcast it back.
      if (origin === 'p2p') return;

      if (suppressBroadcastRef?.current) return;

      invoke("broadcast_update", { 
        path: channelId, 
        data: Array.from(update) 
      }).catch((e) => console.error("Broadcast failed", e));
    };
    
    ydoc.on("update", handleUpdate);
    return () => {
      ydoc.off("update", handleUpdate);
    };
  }, [ydoc, channelId, suppressBroadcastRef]);

  return { editor, ydoc };
}