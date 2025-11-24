// src-frontend/mod-engine/DocumentRegistry.ts
import * as Y from "yjs";
import { invoke } from "@tauri-apps/api/core";
import { debounce } from "lodash-es";

interface DocEntry {
  doc: Y.Doc;
  isSynced: boolean;
  saveTimeout: any;
}

class DocumentRegistry {
  private docs: Map<string, DocEntry> = new Map();
  private rootPath: string = "";

  constructor() {}

  public setRootPath(path: string) {
    this.rootPath = path;
  }

  private getAbsolutePath(relativePath: string): string {
    if (!this.rootPath) return relativePath;
    const sep = this.rootPath.includes("\\") ? "\\" : "/";
    let root = this.rootPath;
    if (root.endsWith(sep)) root = root.slice(0, -1);
    let rel = relativePath;
    if (rel.startsWith("/") || rel.startsWith("\\")) rel = rel.slice(1);
    return `${root}${sep}${rel}`;
  }

  public getOrCreateDoc(path: string): Y.Doc {
    let entry = this.docs.get(path);
    if (entry) return entry.doc;

    const newDoc = new Y.Doc();
    const newEntry: DocEntry = {
      doc: newDoc,
      isSynced: false,
      saveTimeout: null,
    };
    this.docs.set(path, newEntry);
    this.loadDocFromDisk(path, newDoc, newEntry);
    this.attachSaveHandler(path, newEntry);
    return newDoc;
  }
    
  public applyUpdate(path: string, update: Uint8Array) {
    const doc = this.getOrCreateDoc(path);
    Y.applyUpdate(doc, update, 'p2p'); 
    const entry = this.docs.get(path);
    if(entry) entry.isSynced = true;
  }

  // Helper to manually trigger a save (e.g. from the Save button)
  public async manualSave(relativePath: string) {
    const entry = this.docs.get(relativePath);
    if (entry) {
        const content = Y.encodeStateAsUpdate(entry.doc);
        const absolutePath = this.getAbsolutePath(relativePath);
        try {
            await invoke("write_file_content", { path: absolutePath, content: Array.from(content) });
            entry.isSynced = true;
            console.log(`Manually saved ${relativePath}`);
        } catch (e) {
            console.error(`Failed to manually save ${relativePath}:`, e);
            throw e;
        }
    }
  }

  private attachSaveHandler(path: string, entry: DocEntry) {
    const debouncedSave = debounce(() => {
        const content = Y.encodeStateAsUpdate(entry.doc);
        const absolutePath = this.getAbsolutePath(path);

        invoke("write_file_content", { path: absolutePath, content: Array.from(content) })
            .then(() => {
                entry.isSynced = true;
                console.log(`Auto-saved ${path}`);
            })
            .catch(e => console.error(`Failed to save ${path}:`, e));
    }, 1000);

    entry.doc.on('update', (update, origin) => {
        if (origin !== 'p2p') {
            debouncedSave();
            this.broadcastUpdate(path, update)
        }
    });
  }

  private async loadDocFromDisk(path: string, doc: Y.Doc, entry: DocEntry) {
    if (entry.isSynced) return;
    try {
      const absolutePath = this.getAbsolutePath(path);
      const content: number[] = await invoke("read_file_content", { path: absolutePath });
      if (content && content.length > 0) {
        Y.applyUpdate(doc, new Uint8Array(content), 'disk');
        console.log(`Loaded ${path} from disk.`);
      }
    } catch (error) {
      console.warn(`Could not load ${path} from disk:`, error);
    }
  }

  private broadcastUpdate(path: string, update: Uint8Array) {
    invoke("broadcast_update", {
      path: path,
      data: Array.from(update),
    }).catch((e) => console.error("Broadcast failed", e));
  }
}

export const documentRegistry = new DocumentRegistry();