import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { EventEmitter } from "./EventEmitter";

/**
 * TransportLayer
 * Responsible strictly for sending/receiving packets and managing network identity.
 * No business logic regarding Y.js or FileSystem.
 */
export class P2PService extends EventEmitter {
  private myPeerId: string | null = null;
  private myAddresses: string[] = [];
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
        this.emit('peer-connected');
      }),
      await listen("peer-disconnected", () => {
        this.emit('peer-disconnected');
      }),
      await listen<string>("join-requested", (e) => {
        this.emit('join-requested', e.payload);
      }),
      await listen<number[]>("join-accepted", async (e) => {
        this.emit('join-accepted', e.payload);
      }),
      await listen<string>("host-disconnected", (e) => {
        this.emit('host-disconnected', e.payload);
      }),
      await listen<{ path: string, data: number[] }>("p2p-sync", (e) => {
        this.emit('sync-packet', e.payload);
      }),
      await listen<{ path: string }>("sync-requested", async (e) => {
        this.emit('sync-requested', e.payload.path);
      })
    );
  }

  // --- Actions ---

  async sendJoinRequest(peerId: string, remoteAddrs: string[]) {
    await invoke("request_join", { peerId, remoteAddrs });
  }

  async approveJoin(peerId: string, projectPath: string) {
    await invoke("approve_join", { peerId, projectPath });
  }

  async requestFileSync(path: string) {
    await invoke("request_file_sync", { path });
  }

  async broadcastUpdate(path: string, data: number[]) {
    await invoke("broadcast_update", { path, data });
  }

  async destroy() {
    this.unlistenFns.forEach(unlisten => unlisten());
    this.unlistenFns = [];
  }

  getPeerId() { return this.myPeerId; }
  getAddresses() { return this.myAddresses; }
}