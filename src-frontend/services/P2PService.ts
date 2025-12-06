import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { workspaceManager } from "./WorkspaceManager";
import * as Y from "yjs";
import { EventEmitter } from "./EventEmitter";

export class P2PService extends EventEmitter {
  private myPeerId: string | null = null;
  private myAddresses: string[] = [];
  private connectedPeers: number = 0;
  private isHost: boolean = true;
  private isJoining: boolean = false;
  private unlistenFns: UnlistenFn[] = []; 
  private initialized = false;

  constructor() {
    super();
  }

  async init() {
    if (this.initialized) return;
    this.initialized = true;

    // Get Identity
    this.myPeerId = await invoke<string>("get_local_peer_id").catch(() => null);
    const addrs = await invoke<string[]>("get_local_addrs").catch(() => []);
    this.myAddresses = Array.from(new Set(addrs));
    this.emit('identity-updated', { peerId: this.myPeerId, addresses: this.myAddresses });

    // Setup Listeners
    this.unlistenFns.push(
      await listen<string>("local-peer-id", (e) => {
        this.myPeerId = e.payload;
        this.emit('identity-updated', { peerId: this.myPeerId, addresses: this.myAddresses });
      }),
      await listen<string>("new-listen-addr", (e) => {
        if (!this.myAddresses.includes(e.payload)) {
          this.myAddresses.push(e.payload);
          this.emit('identity-updated', { peerId: this.myPeerId, addresses: this.myAddresses });
        }
      }),
      await listen("peer-connected", () => {
        this.connectedPeers++;
        this.emit('peers-changed', this.connectedPeers);
      }),
      await listen("peer-disconnected", () => {
        this.connectedPeers = Math.max(0, this.connectedPeers - 1);
        this.emit('peers-changed', this.connectedPeers);
      }),
      await listen<string>("join-requested", (e) => {
        this.emit('join-requested', e.payload);
      }),
      await listen<number[]>("join-accepted", async (e) => {
        this.isHost = false;
        this.isJoining = false;
        this.emit('status-change', "Joined session! Folder synced.");
        this.emit('project-received', e.payload);
        this.emit('role-changed', false);
      }),
      await listen<string>("host-disconnected", (e) => {
        this.isHost = true;
        this.emit('host-disconnected', e.payload);
        this.emit('role-changed', true); 
        this.emit('status-change', "⚠ Host disconnected! Negotiating...");
      }),
      await listen<{ path: string, data: number[] }>("p2p-sync", (e) => {
        this.handleSyncPacket(e.payload);
      }),
      await listen<{ path: string }>("sync-requested", async (e) => {
        const requestedPath = e.payload.path;
        const doc = workspaceManager.getOrCreateDoc(requestedPath);
        const state = Y.encodeStateAsUpdate(doc);
        invoke("broadcast_update", { path: requestedPath, data: Array.from(state) }).catch(console.error);
      })
    );
  }

  private handleSyncPacket(payload: { path: string, data: number[] }) {
    const { path, data } = payload;
    
    if (this.isJoining) {
        this.isJoining = false;
        this.isHost = false;
        this.emit('role-changed', false);
        this.emit('status-change', "Joined session (Synced).");
    }

    if (path.match(/\.(png|jpg|jpeg|gif|svg|webp)$/i) || path.startsWith("resources/")) {
        workspaceManager.writeAsset(path, new Uint8Array(data));
    } else {
        workspaceManager.applyUpdate(path, new Uint8Array(data));
    }
    this.emit('file-synced', path);
  }

  async sendJoinRequest(peerId: string, remoteAddrs: string[] = []) {
    this.isJoining = true;
    this.emit('status-change', `Requesting to join ${peerId.slice(0, 8)}...`);
    try {
      await invoke("request_join", { peerId, remoteAddrs });
    } catch (e: any) {
      this.isJoining = false;
      this.emit('status-change', `Error joining: ${e}`);
    }
  }

  async approveJoin(peerId: string, projectPath: string) {
    await invoke("approve_join", { peerId, projectPath });
  }

  async requestFileSync(path: string) {
    await invoke("request_file_sync", { path });
  }

  async destroy() {
    this.unlistenFns.forEach(unlisten => unlisten());
    this.unlistenFns = [];
  }

  getPeerId() { return this.myPeerId; }
  getAddresses() { return this.myAddresses; }
  getIsHost() { return this.isHost; }
}