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
  icon: string;
  label: string;
  component: React.FC<any>;
}

export interface HostAPI {
  editor: {
    // Allows plugins to register Tiptap extensions
    registerExtension: (ext: Node | Extension) => void;
    // Expose commands and state for manipulation
    getCommands: () => any; 
    getState: () => EditorState | null;
  };
  ui: {
    registerSidebarTab: (tab: SidebarTab) => void;
    showNotification: (msg: string) => void;
  };
  data: {
    getDoc: () => Y.Doc;
    getMap: (name: string) => Y.Map<any>;
    fs: {
      readFile: (path: string) => Promise<number[]>;
      writeFile: (path: string, content: number[]) => Promise<void>;
    }
  };
}

// --- NEW: Plugin System Types ---

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  main: string; // e.g. "index.js"
  contributes?: {
    slashMenu?: Array<{ command: string; title: string; description: string }>;
  };
}

export interface ActivePlugin {
  manifest: PluginManifest;
  instance: any; // The exported module
  cleanup?: () => void;
}