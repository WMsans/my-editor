import * as Y from "yjs";
import { invoke } from "@tauri-apps/api/core";
import { debounce } from "lodash-es";
import { EventEmitter } from "./EventEmitter";

interface DocEntry {
  doc: Y.Doc;
  isSynced: boolean;
  saveDebounce: (() => void) | null;
}

export class WorkspaceManager extends EventEmitter {
  private docs: Map<string, DocEntry> = new Map();
  private rootPath: string = "";
  private isHost: boolean = true;
  private currentRelativePath: string | null = null;

  constructor() {
    super();
  }

  public setRootPath(path: string) {
    this.rootPath = path;
    // Clear docs on project switch? Ideally yes, but for now we keep cache or clear
    this.docs.clear();
    this.currentRelativePath = null;
  }

  public setIsHost(isHost: boolean) {
    this.isHost = isHost;
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

  /**
   * Opens a file, loads it from disk if needed, and sets it as the active document.
   * Emits 'doc-changed' event.
   */
  public async openFile(relativePath: string | null) {
    this.currentRelativePath = relativePath;
    
    if (!relativePath) {
        // Untitled / No file
        this.emit('doc-changed', null);
        return;
    }

    const doc = this.getOrCreateDoc(relativePath);
    this.emit('doc-changed', doc);
  }

  public getCurrentDoc(): Y.Doc | null {
      if (!this.currentRelativePath) return null;
      return this.getOrCreateDoc(this.currentRelativePath);
  }

  public getOrCreateDoc(relativePath: string): Y.Doc {
    let entry = this.docs.get(relativePath);
    if (entry) return entry.doc;

    const newDoc = new Y.Doc();
    const newEntry: DocEntry = {
      doc: newDoc,
      isSynced: false,
      saveDebounce: null,
    };
    
    this.docs.set(relativePath, newEntry);
    this.loadDocFromDisk(relativePath, newDoc, newEntry);
    this.attachSaveHandler(relativePath, newEntry);
    
    return newDoc;
  }

  // --- I/O Logic ---

  public async saveCurrentFile() {
      if (!this.currentRelativePath) throw new Error("No file open to save.");
      if (!this.isHost) throw new Error("Guests cannot save directly.");
      
      const entry = this.docs.get(this.currentRelativePath);
      if (entry) {
          await this.performSave(this.currentRelativePath, entry);
      }
  }

  private async performSave(relativePath: string, entry: DocEntry) {
      const content = Y.encodeStateAsUpdate(entry.doc);
      const absolutePath = this.getAbsolutePath(relativePath);
      await invoke("write_file_content", { path: absolutePath, content: Array.from(content) });
      entry.isSynced = true;
      console.log(`Saved ${relativePath}`);
  }

  private attachSaveHandler(path: string, entry: DocEntry) {
    const debouncedSave = debounce(() => {
        if (!this.isHost) return;
        this.performSave(path, entry).catch(e => console.error("Auto-save failed", e));
    }, 1000);

    entry.saveDebounce = debouncedSave;

    entry.doc.on('update', (update, origin) => {
        if (this.isHost) {
            debouncedSave();
        }
        // Broadcast P2P updates
        if (origin !== 'p2p') {
            this.broadcastUpdate(path, update);
        }
    });
  }

  private async loadDocFromDisk(path: string, doc: Y.Doc, entry: DocEntry) {
    try {
      const absolutePath = this.getAbsolutePath(path);
      const content: number[] = await invoke("read_file_content", { path: absolutePath });
      if (content && content.length > 0) {
        Y.applyUpdate(doc, new Uint8Array(content), 'disk');
        entry.isSynced = true;
      }
    } catch (error) {
      // New file or read error
    }
  }

  // --- P2P Integration ---

  public applyUpdate(relativePath: string, update: Uint8Array) {
    const doc = this.getOrCreateDoc(relativePath);
    Y.applyUpdate(doc, update, 'p2p'); 
    
    // If we are currently viewing this file, the EditorView (via useCollaborativeEditor) 
    // is already attached to this Y.Doc instance, so it updates automatically.
  }

  public async writeAsset(relativePath: string, content: Uint8Array) {
    const absolutePath = this.getAbsolutePath(relativePath);
    try {
        // Ensure dir exists
        const sep = this.rootPath.includes("\\") ? "\\" : "/";
        const lastSlash = absolutePath.lastIndexOf(sep);
        if (lastSlash !== -1) {
            await invoke("create_directory", { path: absolutePath.substring(0, lastSlash) });
        }
        await invoke("write_file_content", { path: absolutePath, content: Array.from(content) });
    } catch(e) {
        console.error(`Failed to write asset ${relativePath}`, e);
    }
  }

  private broadcastUpdate(path: string, update: Uint8Array) {
    invoke("broadcast_update", {
      path: path,
      data: Array.from(update),
    }).catch(console.error);
  }
}

export const workspaceManager = new WorkspaceManager();