import * as Y from "yjs";
import { EventEmitter } from "./EventEmitter";
import { P2PService } from "./P2PService";

/**
 * SyncManager
 * Manages Y.js documents, applies updates from P2P, and emits updates to be saved.
 */
export class CollabService extends EventEmitter {
  private docs: Map<string, Y.Doc> = new Map();
  private p2p: P2PService;
  private isHost: boolean = true;

  constructor(p2pService: P2PService) {
    super();
    this.p2p = p2pService;
    this.setupListeners();
  }

  private setupListeners() {
    this.p2p.on('sync-packet', ({ path, data }: { path: string, data: number[] }) => {
        this.applyUpdate(path, new Uint8Array(data), 'p2p');
    });

    this.p2p.on('sync-requested', (path: string) => {
        const doc = this.getDoc(path);
        if (doc) {
            const state = Y.encodeStateAsUpdate(doc);
            this.p2p.broadcastUpdate(path, Array.from(state));
        }
    });
  }

  public setRole(isHost: boolean) {
      this.isHost = isHost;
  }

  public getDoc(path: string): Y.Doc | undefined {
      return this.docs.get(path);
  }

  public getOrCreateDoc(path: string, initialContent?: Uint8Array): Y.Doc {
      let doc = this.docs.get(path);
      if (!doc) {
          doc = new Y.Doc();
          this.docs.set(path, doc);
          
          if (initialContent) {
              Y.applyUpdate(doc, initialContent, 'disk');
          }

          doc.on('update', (update, origin) => {
              if (origin !== 'p2p' && origin !== 'disk') {
                  this.p2p.broadcastUpdate(path, Array.from(update));
                  // If we are host, this change should be saved
                  if (this.isHost) {
                      this.emit('doc-updated-locally', { path, doc });
                  }
              }
              // If origin is p2p and we are host, we also need to save
              if (origin === 'p2p' && this.isHost) {
                  this.emit('doc-updated-locally', { path, doc });
              }
          });
      }
      return doc;
  }

  public applyUpdate(path: string, update: Uint8Array, origin: string) {
      // Ignore heartbeat signals
      if (path === '.heartbeat') return;

      // If it's a binary asset (image), handle differently or ignore for Y.Doc
      if (path.match(/\.(png|jpg|jpeg|gif|svg|webp)$/i)) {
          this.emit('asset-received', { path, content: update });
          return;
      }

      const doc = this.getOrCreateDoc(path);
      Y.applyUpdate(doc, update, origin);
  }

  public closeDoc(path: string) {
      const doc = this.docs.get(path);
      if (doc) {
          doc.destroy();
          this.docs.delete(path);
      }
  }

  public clearAll() {
      this.docs.forEach(doc => doc.destroy());
      this.docs.clear();
  }
}