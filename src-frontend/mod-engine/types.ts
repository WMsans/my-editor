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

// --- NEW Plugin API Types (Phase 2) ---

export interface TreeItem {
  id?: string;
  label: string;
  collapsibleState?: 'none' | 'collapsed' | 'expanded';
  icon?: string; // emoji or identifier
  description?: string;
  tooltip?: string;
  contextValue?: string;
  command?: {
      command: string;
      title: string;
      arguments?: any[];
  };
}

export interface TreeDataProvider<T = any> {
    getChildren(element?: T): Promise<T[]>;
    getTreeItem(element: T): Promise<TreeItem> | TreeItem;
}

export interface TreeViewOptions<T> {
    treeDataProvider: TreeDataProvider<T>;
}

export interface TreeView<T> {
    dispose(): void;
    reveal(element: T, options?: { select?: boolean; focus?: boolean; expand?: boolean | number }): Promise<void>;
}

// --- Top Bar / Toolbar Types ---

export type TopbarItemType = 'button' | 'text' | 'dropdown';

export interface TopbarItemOptions {
    id: string; 
    type: TopbarItemType;
    label?: string;       // Button text or Label for input
    value?: string;       // Initial value for input/text
    placeholder?: string; // For inputs
    options?: string[];   // For dropdowns
    width?: string;       // CSS width (e.g. "100px")
    tooltip?: string;
    icon?: string;
    disabled?: boolean;   // [NEW] Support for disabled state
    onClick?: () => void;
    onChange?: (value: string) => void;
}

export interface TopbarItemControl {
    update(options: Partial<TopbarItemOptions>): void;
    dispose(): void;
}

// Internal representation in Registry
export interface RegisteredTopbarItem extends TopbarItemOptions {
    pluginId: string;
}

// --- Contribution Types ---

export interface SidebarTab {
  id: string;
  icon: string;
  label: string;
  component: React.FC<any>;
}

export interface CommandContribution {
    command: string;
    title: string;
    category?: string;
}

export interface ViewContainerContribution {
    id: string;
    title: string;
    icon: string;
}

export interface ViewContribution {
    id: string;
    name: string;
    type?: string; 
}

export interface Disposable {
    dispose(): void;
}

export interface HostAPI {
  // [PHASE 4] Event Bus
  events: {
      emit: (event: string, data?: any) => void;
      on: (event: string, handler: (data: any) => void) => Disposable;
  };

  // [PHASE 2] Window / UI API (Data Driven)
  window: {
      createTreeView: <T>(viewId: string, options: TreeViewOptions<T>) => TreeView<T>;
      createTopbarItem: (options: TopbarItemOptions) => TopbarItemControl;
      showInformationMessage: (message: string, ...items: string[]) => Promise<string | undefined>;
  };
  
  editor: {
    registerExtension: (ext: Node | Extension, options?: { priority?: 'high' | 'normal' }) => void;
    registerWebviewBlock: (id: string, options: { initialHtml: string; initialScript?: string; attributes?: Record<string, any> }) => void;
    insertContent: (content: any) => void;
    getCommands: () => any; 
    getState: () => EditorState | null;
    getSafeInstance: () => Editor | null;
  };
  ui: {
    // Deprecated in favor of window.createTreeView for new plugins
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
  executionEnvironment?: 'main' | 'worker'; 

  contributes?: {
    commands?: CommandContribution[];
    viewsContainers?: {
      activitybar?: ViewContainerContribution[];
    };
    views?: {
      [containerId: string]: ViewContribution[];
    };
    slashMenu?: Array<{ command: string; title: string; description: string }>;
  };
}

export interface ActivePlugin {
  manifest: PluginManifest;
  instance: any;
  cleanup?: () => void;
}