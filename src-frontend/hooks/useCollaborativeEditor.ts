import { useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import { Markdown } from "@tiptap/markdown";
import BubbleMenuExtension from "@tiptap/extension-bubble-menu"; 
import * as Y from "yjs";

import { registry } from "../mod-engine/Registry";

export function useCollaborativeEditor(doc: Y.Doc | null, isReady: boolean) {
  // [FIX] Define extensions conditionally. 
  // If the app is not ready (plugins not loaded), do NOT include Collaboration.
  // This prevents the editor from trying to sync/parse content (like simulationBlock)
  // before the schema for it is registered.
  const extensions = isReady 
    ? [
        // High Priority Plugins go FIRST
        ...registry.getHighPriorityExtensions(),
        
        StarterKit.configure({ 
          // @ts-ignore
          history: false 
        }),
        Collaboration.configure({ document: doc || new Y.Doc() }),
        Markdown,
        BubbleMenuExtension,
        
        // Standard plugins
        ...registry.getExtensions() 
      ]
    : [
        // Minimal setup for the loading state (no collaboration, no plugins)
        StarterKit.configure({ 
          // @ts-ignore
          history: false 
        }),
    ];

  const editor = useEditor({
    extensions,
    editorProps: { attributes: { class: "editor-content" } },
  }, [doc, isReady]); // Re-init when isReady changes

  return { editor };
}