import * as Y from "yjs";
import { debounce } from "lodash-es";
import { EventEmitter } from "./EventEmitter";
import { FileSystemService } from "./FileSystemService";
import { CollabService } from "./CollabService";

/**
 * Mediator
 * Coordinates Disk <-> CollabService
 */
export class WorkspaceManager extends EventEmitter {
  private rootPath: string = "";
  private currentRelativePath: string | null = null;
  private saveDebouncers: Map<string, () => void> = new Map();

  constructor(
      private fs: FileSystemService,
      private collab: CollabService
  ) {
    super();
    this.setupListeners();
  }

  private setupListeners() {
      // When CollabService says a doc changed locally (and we are host), save it
      this.collab.on('doc-updated-locally', ({ path, doc }: { path: string, doc: Y.Doc }) => {
          this.scheduleSave(path, doc);
      });

      this.collab.on('asset-received', ({ path, content }: { path: string, content: Uint8Array }) => {
          this.writeAsset(path, content);
      });
  }

  public setRootPath(path: string) {
      this.rootPath = path;
      this.collab.clearAll();
      this.currentRelativePath = null;
  }

  public getAbsolutePath(relativePath: string): string {
    if (!this.rootPath) return relativePath;
    const sep = this.rootPath.includes("\\") ? "\\" : "/";
    // Normalize logic
    let rel = relativePath;
    if (rel.startsWith("/") || rel.startsWith("\\")) rel = rel.slice(1);
    return `${this.rootPath}${sep}${rel}`;
  }

  public async openFile(relativePath: string | null) {
      this.currentRelativePath = relativePath;
      if (!relativePath) {
          this.emit('doc-changed', null);
          return;
      }

      // Check if already in memory
      let doc = this.collab.getDoc(relativePath);
      if (!doc) {
          // Load from disk
          try {
              const absPath = this.getAbsolutePath(relativePath);
              const content = await this.fs.readFile(absPath);
              doc = this.collab.getOrCreateDoc(relativePath, new Uint8Array(content));
          } catch (e) {
              // New file?
              doc = this.collab.getOrCreateDoc(relativePath);
          }
      }
      this.emit('doc-changed', doc);
  }

  public getCurrentDoc(): Y.Doc | null {
      if (!this.currentRelativePath) return null;
      return this.collab.getDoc(this.currentRelativePath) || null;
  }

  // --- Save Logic ---
  
  public async saveCurrentFile() {
      if (!this.currentRelativePath) return;
      const doc = this.collab.getDoc(this.currentRelativePath);
      if (doc) await this.performSave(this.currentRelativePath, doc);
  }

  private scheduleSave(path: string, doc: Y.Doc) {
      if (this.saveDebouncers.has(path)) return; // Already scheduled

      const debouncer = debounce(() => {
          this.performSave(path, doc);
          this.saveDebouncers.delete(path);
      }, 2000);

      this.saveDebouncers.set(path, debouncer);
      debouncer();
  }

  private async performSave(path: string, doc: Y.Doc) {
      const content = Y.encodeStateAsUpdate(doc);
      const absPath = this.getAbsolutePath(path);
      try {
          await this.fs.writeFile(absPath, content);
          console.log(`[WorkspaceManager] Saved ${path}`);
      } catch (e) {
          console.error(`[WorkspaceManager] Failed to save ${path}`, e);
      }
  }

  private async writeAsset(relativePath: string, content: Uint8Array) {
      const absPath = this.getAbsolutePath(relativePath);
      try {
           // Ensure directory exists logic could go here
           await this.fs.writeFile(absPath, content);
      } catch (e) {
          console.error("Asset write failed", e);
      }
  }
}