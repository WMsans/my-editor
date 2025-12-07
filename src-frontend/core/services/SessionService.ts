import { P2PService } from "./P2PService";
import { AuthService } from "./AuthService";
import { FileSystemService } from "./FileSystemService";
import { CollabService } from "./CollabService"; 
import { useSessionStore } from "../stores/useSessionStore";
import { pluginLoader } from "../../engine/PluginLoader";
import { useUIStore } from "../stores/useUIStore";
import { useProjectStore } from "../stores/useProjectStore";

const META_FILE = ".collab_meta.json";

export class SessionService {
  private p2p: P2PService;
  private auth: AuthService;
  private fs: FileSystemService;
  private collab: CollabService;

  // Heartbeat Config
  private heartbeatInterval: any = null;
  private heartbeatTimeout: any = null;
  private readonly HEARTBEAT_RATE = 1000;    // Send every 1s
  private readonly HEARTBEAT_TIMEOUT = 2500; // Die if no signal for 2.5s
  
  constructor(
      p2p: P2PService, 
      auth: AuthService, 
      fs: FileSystemService,
      collab: CollabService
  ) {
    this.p2p = p2p;
    this.auth = auth;
    this.fs = fs;
    this.collab = collab;
    this.setupListeners();
  }

  private setupListeners() {
    this.p2p.on('peer-connected', () => {
        const store = useSessionStore.getState();
        store.setConnectedPeers(store.connectedPeers + 1);
    });
    
    this.p2p.on('peer-disconnected', () => {
        const store = useSessionStore.getState();
        store.setConnectedPeers(Math.max(0, store.connectedPeers - 1));
    });

    this.p2p.on('join-requested', (peerId: string) => {
        useSessionStore.getState().setIncomingRequest(peerId);
    });

    this.p2p.on('join-accepted', (data: number[]) => {
       useSessionStore.getState().setStatus('syncing', "Joined! Syncing project...");
       this.setHostRole(false); 
    });

    this.p2p.on('host-disconnected', (id: string) => {
        this.handleHostLoss(id);
    });

    // Listen for heartbeat packets
    this.p2p.on('sync-packet', ({ path }: { path: string }) => {
        if (path === '.heartbeat') {
            this.resetHeartbeatTimeout();
        }
    });
  }

  private setHostRole(isHost: boolean) {
      useSessionStore.getState().setIsHost(isHost);
      this.collab.setRole(isHost);

      if (isHost) {
          this.startHeartbeatEmitter();
          this.stopHeartbeatListener();
      } else {
          this.stopHeartbeatEmitter();
          this.startHeartbeatListener();
      }
  }

  // --- Heartbeat Logic ---

  private startHeartbeatEmitter() {
      if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = setInterval(() => {
          this.p2p.broadcastUpdate('.heartbeat', []);
      }, this.HEARTBEAT_RATE);
  }

  private stopHeartbeatEmitter() {
      if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
  }

  private startHeartbeatListener() {
      this.resetHeartbeatTimeout();
  }

  private stopHeartbeatListener() {
      if (this.heartbeatTimeout) clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
  }

  private resetHeartbeatTimeout() {
      if (this.heartbeatTimeout) clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = setTimeout(() => {
          this.handleHostLoss("heartbeat-timeout");
      }, this.HEARTBEAT_TIMEOUT);
  }

  // --- Takeover Logic ---

  private handleHostLoss(id: string) {
      const store = useSessionStore.getState();
      
      // Avoid duplicate triggers
      if (store.status === 'error' || store.status === 'negotiating') return;
      if (store.isHost) return; // Self is host, ignore

      console.warn(`Host lost (${id}). Initiating takeover protocol...`);
      store.setDeadHostId(id);
      
      this.attemptTakeover();
  }

  private async attemptTakeover() {
      const store = useSessionStore.getState();
      const rootPath = useProjectStore.getState().rootPath;
      if (!rootPath) {
          store.setStatus('error', "Host disconnected. No project to takeover.");
          this.setHostRole(true);
          return;
      }

      store.setStatus('negotiating', "Host disconnected. Attempting to recover session...");

      // Random backoff to prevent Git lock contention (500ms - 2000ms)
      // This serves as a simplified leader election (first one to push wins)
      const backoff = 500 + Math.random() * 1500;
      await new Promise(r => setTimeout(r, backoff));

      try {
          // 1. Pull latest meta to see if someone else already took over
          const { sshKeyPath } = useProjectStore.getState();
          const sep = rootPath.includes("\\") ? "\\" : "/";
          const metaPath = `${rootPath}${sep}${META_FILE}`;
          
          try {
             await this.fs.gitPull(rootPath, sshKeyPath || "");
          } catch(e) { console.warn("Pull failed during takeover check", e); }

          let meta: any = {};
          try {
              const content = await this.fs.readFileString(metaPath);
              meta = JSON.parse(content);
          } catch { /* ignore */ }

          const myPeerId = this.p2p.getPeerId();

          // If a VALID host is present in meta, and it's not the dead host, and not me
          // Then someone else became host. Join them.
          if (meta.hostId && meta.hostId !== store.deadHostId && meta.hostId !== "heartbeat-timeout" && meta.hostId !== myPeerId) {
               console.log(`Peer ${meta.hostId} took over. Joining new host...`);
               store.setStatus('negotiating', `Switching to new host...`);
               this.negotiateHost(rootPath);
               return;
          }

          // 2. No one else has taken over yet. I will claim it.
          console.log("No new host found. Claiming host role...");
          await this.claimHost(rootPath, metaPath);

      } catch (e) {
          console.error("Takeover failed", e);
          store.setStatus('error', "Failed to recover session. You are now offline.");
          this.setHostRole(true);
      }
  }

  // --- Negotiation Logic ---

  public async negotiateHost(rootPath: string) {
     const store = useSessionStore.getState();
     store.setStatus('negotiating');

     const myPeerId = this.p2p.getPeerId();
     
     if (!myPeerId) {
         store.setStatus('error', "Network Identity not ready");
         return;
     }

     const metaPath = `${rootPath}/${META_FILE}`;
     let meta: any = {};
     
     try {
         const content = await this.fs.readFileString(metaPath);
         meta = JSON.parse(content);
     } catch { /* No meta file implies we should claim host */ }

     if (meta.encrypted) {
        const success = await this.handleDecryption(meta.securityCheck);
        if (!success) {
            store.setStatus('error', "Decryption failed or cancelled");
            return;
        }
     }

     if (meta.hostId && meta.hostId !== myPeerId) {
         // If dead host is recorded, but we are here, we might need to takeover?
         // But normally negotiateHost is called on startup.
         // If called from attemptTakeover, deadHostId check is handled there.
         
         if (store.deadHostId !== meta.hostId) {
            // Join existing host
            this.setHostRole(false);
            
            const missing = pluginLoader.checkMissingRequirements(meta.requiredPlugins || []);
            if (missing.length > 0) {
                useUIStore.getState().setWarningMsg(`Missing plugins:\n- ${missing.join('\n- ')}`);
                store.setStatus('error', "Missing required plugins");
                return;
            }

            let targetAddrs = meta.hostAddrs || [];
            if (meta.encrypted && typeof targetAddrs === 'string') {
                 try {
                    const decrypted = await this.auth.decrypt(targetAddrs);
                    targetAddrs = JSON.parse(decrypted);
                 } catch {
                     store.setStatus('error', "Failed to decrypt host addresses");
                     return;
                 }
            }
            
            store.setStatus('negotiating', `Joining ${meta.hostId.slice(0,8)}...`);
            await this.p2p.sendJoinRequest(meta.hostId, targetAddrs);
            return;
         }
     }

     // Claim Host
     await this.claimHost(rootPath, metaPath);
  }

  private async claimHost(rootPath: string, metaPath: string) {
      const store = useSessionStore.getState();
      const myPeerId = this.p2p.getPeerId();
      const myAddrs = this.p2p.getAddresses();
      const key = this.auth.getKey();

      let storedAddrs: any = myAddrs;
      let securityCheck = "";

      if (key) {
          try {
              storedAddrs = await this.auth.encrypt(JSON.stringify(myAddrs), key);
              securityCheck = await this.auth.generateValidationToken(key);
          } catch(e) {
              console.error("Encryption failed during claim", e);
          }
      }

      const newMeta = {
          hostId: myPeerId,
          hostAddrs: storedAddrs,
          encrypted: !!key,
          securityCheck,
          requiredPlugins: pluginLoader.getEnabledUniversalPlugins()
      };

      await this.fs.writeFileString(metaPath, JSON.stringify(newMeta, null, 2));

      const { sshKeyPath } = useProjectStore.getState();
      try {
          store.setStatus('negotiating', "Publishing session...");
          await this.fs.gitPull(rootPath, sshKeyPath || "");
          await this.fs.pushChanges(rootPath, sshKeyPath);
      } catch (e) {
          console.error("Failed to push host metadata", e);
          useUIStore.getState().setWarningMsg("Session started, but failed to publish to remote. Peers may not be able to discover you automatically.");
      }

      this.setHostRole(true);
      store.setStatus('connected', "Hosting Session");
  }

  private async handleDecryption(token: string): Promise<boolean> {
      if (this.auth.hasKey() && await this.auth.validateToken(token)) return true;

      const requestPassword = useUIStore.getState().requestPassword;
      while (true) {
          const pass = await requestPassword("🔒 Project Encrypted.\nEnter decryption key:");
          if (!pass) return false;

          if (await this.auth.validateToken(token, pass)) {
              this.auth.setKey(pass);
              useProjectStore.getState().setEncryptionKey(pass);
              return true;
          } else {
              alert("Incorrect Key");
          }
      }
  }
}