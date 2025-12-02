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
    registerExtension: (ext: Node | Extension, options?: { priority?: 'high' | 'normal' }) => void;
    getCommands: () => any; 
    getState: () => EditorState | null;
    getSafeInstance: () => Editor | null;
  };
  ui: {
    registerSidebarTab: (tab: SidebarTab) => void;
    showNotification: (msg: string) => void;
  };
  commands: {
    registerCommand: (id: string, handler: (args?: any) => void) => void;
    executeCommand: (id: string, args?: any) => void;
  };
  data: {
    getDoc: () => Y.Doc;
    getMap: (name: string) => Y.Map<any>;
    fs: {
      readFile: (path: string) => Promise<number[]>;
      writeFile: (path: string, content: number[]) => Promise<void>;
      createDirectory: (path: string) => Promise<void>; 
    }
  };
  // [NEW] Plugin Management API
  plugins: {
    getAll: () => Promise<PluginManifest[]>;
    isEnabled: (id: string) => boolean;
    setEnabled: (id: string, enabled: boolean) => void;
  };
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  main: string;
  permissions?: string[];
  
  /**
   * Defines where the plugin runs.
   * - 'main': Runs in UI thread (Access to React/Tiptap). Risks freezing UI.
   * - 'worker': Runs in background Worker. Safe, but limited UI access.
   * @default 'main'
   */
  executionEnvironment?: 'main' | 'worker'; 

  contributes?: {
    slashMenu?: Array<{ command: string; title: string; description: string }>;
  };
}

export interface ActivePlugin {
  manifest: PluginManifest;
  instance: any;
  cleanup?: () => void;
}