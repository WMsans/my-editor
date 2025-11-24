// src-frontend/components/EditorWrapper.tsx
import React from "react";
import { EditorContent } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { SlashMenu } from "./SlashMenu";
import { useCollaborativeEditor } from "../hooks/useCollaborativeEditor";
import * as Y from "yjs";

interface EditorWrapperProps {
  doc: Y.Doc;
  path: string;
  initialContent: string | null;
  suppressBroadcastRef: React.MutableRefObject<boolean>;
}

export const EditorWrapper: React.FC<EditorWrapperProps> = ({ doc, path, initialContent, suppressBroadcastRef }) => {
  // Now guaranteed to have a valid doc
  const { editor } = useCollaborativeEditor(doc, path, initialContent, suppressBroadcastRef);

  if (!editor) return null;

  return (
    <>
      <SlashMenu editor={editor} />
      <BubbleMenu className="bubble-menu" editor={editor}>
         <button onClick={() => editor.chain().focus().toggleBold().run()} className={editor.isActive('bold') ? 'is-active' : ''}>B</button>
         <button onClick={() => editor.chain().focus().toggleItalic().run()} className={editor.isActive('italic') ? 'is-active' : ''}>I</button>
         <button onClick={() => editor.chain().focus().toggleCode().run()} className={editor.isActive('code') ? 'is-active' : ''}>{'</>'}</button>
      </BubbleMenu>
      <EditorContent editor={editor} />
    </>
  );
};