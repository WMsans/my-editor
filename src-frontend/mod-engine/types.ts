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
    // We added 'registerExtension' to the API for plugins to use
    registerExtension: (ext: Node | Extension) => void;
    // Helper to insert content
    insertContent: (content: any) => void; 
    getSafeInstance: () => Editor | null;
  };
  commands: {
    registerCommand: (id: string, callback: () => void) => void;
  };
  ui: {
    registerSidebarTab: (tab: SidebarTab) => void;
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