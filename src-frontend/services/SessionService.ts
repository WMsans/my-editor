import { P2PService } from "./P2PService";
import { AuthService } from "./AuthService";
import { FileSystemService } from "./FileSystemService";
import { CollabService } from "./CollabService"; 
import { useSessionStore } from "../stores/useSessionStore";
import { pluginLoader } from "../mod-engine/PluginLoader";
import { useUIStore } from "../stores/useUIStore";
import { useProjectStore } from "../stores/useProjectStore"; // Added missing import

const META_FILE = ".collab_meta.json";

export class SessionService {
  private p2p: P2PService;
  private auth: AuthService;
  private fs: FileSystemService;
  private collab: CollabService;
  
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
       const store = useSessionStore.getState();
       this.setHostRole(false); 
       store.setStatus('syncing', "Joined! Syncing project...");
    });

    this.p2p.on('host-disconnected', (id: string) => {
        useSessionStore.getState().setDeadHostId(id);
        useSessionStore.getState().setStatus('error', "Host disconnected");
        this.setHostRole(true); // Fallback to local mode
    });
  }

  private setHostRole(isHost: boolean) {
      useSessionStore.getState().setIsHost(isHost);
      this.collab.setRole(isHost);
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