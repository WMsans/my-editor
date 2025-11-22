// src-frontend/mod-engine/types.ts
import { Node, Extension } from "@tiptap/core";
import { ReactNode } from "react";

export interface BlockProps {
  node: any;
  updateAttributes: (attrs: any) => void;
  deleteNode: () => void;
}

export interface Mod {
  id: string;
  name: string;
  description: string;
  // The Tiptap extension (Node or Extension)
  extension: Node | Extension;
  // The React component to render for this block (if it's a NodeView)
  component?: React.FC<BlockProps>;
}