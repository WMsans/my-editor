import { useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import { Markdown } from "@tiptap/markdown";
import BubbleMenuExtension from "@tiptap/extension-bubble-menu"; 
import * as Y from "yjs";

import { registry } from "../mod-engine/Registry";

export function useCollaborativeEditor(doc: Y.Doc | null) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ 
        // @ts-ignore
        history: false 
      }),
      Collaboration.configure({ document: doc || new Y.Doc() }),
      Markdown,
      BubbleMenuExtension,
      ...registry.getExtensions() // This now handles the dynamic plugins
    ],
    editorProps: { attributes: { class: "editor-content" } },
  }, [doc]);

  return { editor };
}