import { Node, Extension } from "@tiptap/core";
import { Editor } from "@tiptap/react";
import { EditorState } from "@tiptap/pm/state";
import * as Y from "yjs";
import React from "react";

// --- Existing Block Types ---
export interface BlockProps {
  node: any;
  updateAttributes: (attrs: any) => void;
  deleteNode: () => void;
}

export interface Mod {
  id: string;
  name: string;
  description: string;
  extension: Node | Extension;
  component?: React.FC<BlockProps>;
}

// --- NEW Plugin API Types ---

export interface SidebarTab {
  id: string;
  icon: string; // Emoji or simple text for now
  label: string;
  component: React.FC<any>;
}

export interface HostAPI {
  editor: {
    getCommands: () => Editor["commands"] | null;
    getState: () => EditorState | null;
    registerExtension: (ext: Node | Extension) => void;
  };
  ui: {
    registerSidebarTab: (tab: SidebarTab) => void;
    showNotification: (msg: string) => void;
  };
  data: {
    getDoc: () => Y.Doc;
    getMap: <T = any>(name: string) => Y.Map<T>;
    fs: {
      readFile: (path: string) => Promise<number[]>;
      writeFile: (path: string, content: number[]) => Promise<void>;
    };
  };
}

export interface Plugin {
  id: string;
  name: string;
  activate: (api: HostAPI) => void;
}