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
        // Use the correct method on registry. 
        // We pass the raw extension to Tiptap.
        registry.registerExtension(ext);
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
      getMap: (name: string) => {
        const editor = getEditor();
        const doc = (editor?.storage?.collaboration as any)?.doc;
        if (doc) return doc.getMap(name);
        return new Y.Doc().getMap(name); 
      },
      fs: {
        readFile: async (path: string) => {
          return await invoke<number[]>("read_file_content", { path });
        },
        writeFile: async (path: string, content: number[]) => {
          return await invoke("write_file_content", { path, content });
        }
      }
    }
  };
};