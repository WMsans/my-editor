import * as Y from "yjs";
import { invoke } from "@tauri-apps/api/core";
import { debounce } from "lodash-es";

// Type definition for the document entry in the registry
interface DocEntry {
  doc: Y.Doc;
  isSynced: boolean; // True if the doc has received updates from peers or has been saved
  saveTimeout: any; // For debouncing save operations
}

class DocumentRegistry {
  private docs: Map<string, DocEntry> = new Map();
  private rootPath: string = "";

  constructor() {
    // Potentially initialize with documents from a persisted state in the future
  }

  public setRootPath(path: string) {
    this.rootPath = path;
  }

  private getAbsolutePath(relativePath: string): string {
    if (!this.rootPath) return relativePath;
    
    const sep = this.rootPath.includes("\\") ? "\\" : "/";
    let root = this.rootPath;
    // Remove trailing slash if present
    if (root.endsWith(sep)) root = root.slice(0, -1);
    
    let rel = relativePath;
    // Remove leading slash if present
    if (rel.startsWith("/") || rel.startsWith("\\")) rel = rel.slice(1);
    
    return `${root}${sep}${rel}`;
  }

  /**
   * Retrieves an existing Y.Doc for a given path or creates a new one.
   * If a new doc is created, it attempts to load its initial content from disk.
   *
   * @param path The relative path of the file.
   * @returns The Y.Doc instance for the given path.
   */
  public getOrCreateDoc(path: string): Y.Doc {
    let entry = this.docs.get(path);

    if (entry) {
      return entry.doc;
    }

    // Create a new document
    const newDoc = new Y.Doc();
    const newEntry: DocEntry = {
      doc: newDoc,
      isSynced: false,
      saveTimeout: null,
    };
    this.docs.set(path, newEntry);

    // Asynchronously load content from disk
    this.loadDocFromDisk(path, newDoc, newEntry);

    // Attach a save handler that persists changes to disk after a debounce period
    this.attachSaveHandler(path, newEntry);

    return newDoc;
  }
    
  /**
   * Applies a given update to the specified document.
   * This is typically called when an update is received from a peer.
   *
   * @param path The path of the document to update.
   * @param update The update payload (as a Uint8Array).
   */
  public applyUpdate(path: string, update: Uint8Array) {
    const doc = this.getOrCreateDoc(path);
    Y.applyUpdate(doc, update, 'p2p'); 
    
    const entry = this.docs.get(path);
    if(entry) {
        entry.isSynced = true;
    }
  }

  /**
   * Attaches an observer to the Y.Doc that saves its content to disk when updated.
   * The save operation is debounced to avoid excessive writes.
   *
   * @param path The file path associated with the document.
   * @param entry The DocEntry object from the registry.
   */
  private attachSaveHandler(path: string, entry: DocEntry) {
    const debouncedSave = debounce(() => {
        const content = Y.encodeStateAsUpdate(entry.doc);
        // FIX: Resolve to absolute path before writing
        const absolutePath = this.getAbsolutePath(path);

        invoke("write_file_content", { path: absolutePath, content: Array.from(content) })
            .then(() => {
                entry.isSynced = true; // Mark as synced after successful save
                console.log(`Saved ${path} to disk at ${absolutePath}`);
            })
            .catch(e => console.error(`Failed to save ${path}:`, e));
    }, 1000); // 1-second debounce

    entry.doc.on('update', (update, origin) => {
        // We only save if the update is local (not from p2p)
        if (origin !== 'p2p') {
            debouncedSave();
            this.broadcastUpdate(path, update)
        }
    });
  }

  /**
   * Loads the initial state of a document from the filesystem.
   *
   * @param path The path of the file to load.
   * @param doc The Y.Doc to populate.
   * @param entry The DocEntry to update.
   */
  private async loadDocFromDisk(path: string, doc: Y.Doc, entry: DocEntry) {
    // Only load from disk if no peer updates have been received yet.
    if (entry.isSynced) {
      console.log(`Skipping disk load for ${path} as it has already been synced.`);
      return;
    }

    try {
      // FIX: Resolve to absolute path before reading
      const absolutePath = this.getAbsolutePath(path);
      const content: number[] = await invoke("read_file_content", { path: absolutePath });
      
      if (content && content.length > 0) {
        // Apply the loaded content without triggering an 'update' event that would be broadcast
        Y.applyUpdate(doc, new Uint8Array(content), 'disk');
        console.log(`Loaded ${path} from disk.`);
      }
    } catch (error) {
      // It's okay if the file doesn't exist. It will be created on the first save.
      console.warn(`Could not load ${path} from disk:`, error);
    }
  }

  /**
   * Broadcasts a document update to peers.
   *
   * @param path The path of the document that was updated.
   * @param update The update payload.
   */
  private broadcastUpdate(path: string, update: Uint8Array) {
    invoke("broadcast_update", {
      path: path,
      data: Array.from(update),
    }).catch((e) => console.error("Broadcast failed", e));
  }
}

// Export a singleton instance of the registry
export const documentRegistry = new DocumentRegistry();