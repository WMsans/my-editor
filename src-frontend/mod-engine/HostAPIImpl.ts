import { HostAPI } from "./types";
import { Editor } from "@tiptap/react";
import { registry } from "./Registry";
import { documentRegistry } from "./DocumentRegistry";
import { invoke } from "@tauri-apps/api/core";
import * as Y from "yjs";

/**
 * Factory to create the HostAPI object.
 * We use a getter for the editor because the editor instance is recreated
 * whenever the document changes or reloads.
 */
export const createHostAPI = (
  getEditor: () => Editor | null,
  setWarningMsg: (msg: string) => void
): HostAPI => {
  return {
    editor: {
      getCommands: () => getEditor()?.commands || null,
      getState: () => getEditor()?.state || null,
      registerExtension: (ext) => {
        // Dynamic extension registration is tricky in Tiptap after init.
        // For now, we map it to the legacy 'register' flow which might require reload.
        registry.register({
          id: `ext-${Date.now()}`,
          name: "Dynamic Extension",
          description: "Registered via Plugin API",
          extension: ext
        });
        console.warn("Extension registered. Reload/Re-mount editor to apply.");
      }
    },
    ui: {
      registerSidebarTab: (tab) => {
        registry.registerSidebarTab(tab);
      },
      showNotification: (msg) => {
        setWarningMsg(msg);
      }
    },
    data: {
      getDoc: () => {
        const editor = getEditor();
        // Fix: Cast storage.collaboration to any to access the runtime property 'doc'
        return (editor?.storage?.collaboration as any)?.doc || new Y.Doc();
      },
      getMap: (name) => {
        const editor = getEditor();
        const doc = (editor?.storage?.collaboration as any)?.doc;
        if (doc) return doc.getMap(name);
        return new Y.Doc().getMap(name); 
      },
      fs: {
        readFile: async (path) => {
          return await invoke<number[]>("read_file_content", { path });
        },
        writeFile: async (path, content) => {
          return await invoke("write_file_content", { path, content });
        }
      }
    }
  };
};