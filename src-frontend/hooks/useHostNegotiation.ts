import { useEffect, useRef } from "react";
import { pluginLoader } from "../mod-engine/PluginLoader";
import { fsService, authService } from "../services";

const META_FILE = ".collab_meta.json";

interface UseHostNegotiationProps {
  rootPath: string;
  myPeerId: string | null;
  myAddresses: string[];
  sshKeyPathRef: React.MutableRefObject<string>;
  encryptionKeyRef: React.MutableRefObject<string>;
  setEncryptionKey: (key: string) => void;
  isHost: boolean;
  deadHostIdRef: React.MutableRefObject<string | null>;
  isAutoJoiningRef: React.MutableRefObject<boolean>;
  sendJoinRequest: (peerId: string, addrs: string[]) => void;
  setStatus: (status: string) => void;
  setWarningMsg: (msg: string | null) => void;
  requestPassword: (msg: string) => Promise<string | null>;
}

export function useHostNegotiation({
  rootPath, myPeerId, myAddresses, sshKeyPathRef,
  encryptionKeyRef, setEncryptionKey, isHost,
  deadHostIdRef, isAutoJoiningRef, sendJoinRequest,
  setStatus, setWarningMsg, requestPassword
}: UseHostNegotiationProps) {

  const isNegotiatingRef = useRef(false);

  const updateProjectKey = async (newKey: string) => {
    if (!rootPath || !myPeerId) return;
    setStatus("Updating project key...");
    
    try {
        let storedAddrs: any = myAddresses;
        let securityCheck = "";
        
        if (newKey) {
            try {
                storedAddrs = await authService.encrypt(JSON.stringify(myAddresses), newKey);
                securityCheck = await authService.generateValidationToken(newKey);
            } catch (e) {
                setWarningMsg("Encryption failed.");
                return;
            }
        }

        const metaObj = { 
            hostId: myPeerId, 
            hostAddrs: storedAddrs,
            encrypted: !!newKey,
            securityCheck: securityCheck,
            requiredPlugins: pluginLoader.getEnabledUniversalPlugins()
        };

        const metaPath = `${rootPath}/${META_FILE}`;
        await fsService.writeFileString(metaPath, JSON.stringify(metaObj, null, 2));

        setEncryptionKey(newKey);
        authService.setKey(newKey); // Sync to service

        await fsService.pushChanges(rootPath, sshKeyPathRef.current || "");
        setStatus("Key updated & pushed.");
    } catch (e: any) {
        setWarningMsg(`Failed to update key: ${e.toString()}`);
    }
  };

  useEffect(() => {
    if (!rootPath || !myPeerId || !isHost) return;

    const negotiateHost = async (retryCount = 0) => {
        if (retryCount === 0 && isNegotiatingRef.current) return;
        isNegotiatingRef.current = true;

        try {
            setStatus(retryCount > 0 ? `Negotiating (${retryCount + 1})...` : "Negotiating host...");
            const metaPath = `${rootPath}/${META_FILE}`;
            
            try { await fsService.gitPull(rootPath, sshKeyPathRef.current || ""); } catch (e) { /* Ignore */ }

            let metaHost = "";
            let metaAddrs: string[] = [];
            let requiredPlugins: string[] = [];

            try {
                const content = await fsService.readFileString(metaPath);
                const json = JSON.parse(content);
                metaHost = json.hostId;
                requiredPlugins = json.requiredPlugins || [];

                if (json.encrypted) {
                    let decrypted = false;
                    let currentKey = authService.getKey();

                    // Try current key
                    if (currentKey && await authService.validateToken(json.securityCheck, currentKey)) {
                         decrypted = true;
                    }

                    // Prompt loop
                    while (!decrypted) {
                        const pass = await requestPassword("🔒 Project Encrypted.\nEnter decryption key:");
                        if (pass === null) { setStatus("Decryption cancelled."); return; }
                        
                        if (await authService.validateToken(json.securityCheck, pass)) {
                            decrypted = true;
                            setEncryptionKey(pass);
                            authService.setKey(pass);
                            currentKey = pass;
                        } else {
                            alert("Incorrect key.");
                        }
                    }
                    
                    if (typeof json.hostAddrs === 'string') {
                        const addrStr = await authService.decrypt(json.hostAddrs, currentKey);
                        metaAddrs = JSON.parse(addrStr);
                    }
                } else {
                    metaAddrs = json.hostAddrs || [];
                }
            } catch (e) { /* Meta missing/invalid is fine */ }

            // Logic: Join existing host or Claim host
            if (metaHost && metaHost !== myPeerId) {
                if (deadHostIdRef.current !== metaHost) {
                    if (!isHost) return; // Safety

                    const missing = pluginLoader.checkMissingRequirements(requiredPlugins);
                    if (missing.length > 0) {
                        setWarningMsg(`Missing plugins:\n- ${missing.join('\n- ')}`);
                        return;
                    }

                    setStatus(`Found host ${metaHost.slice(0,8)}. Joining...`);
                    isAutoJoiningRef.current = true; 
                    sendJoinRequest(metaHost, metaAddrs || []);
                    return; 
                }
            }

            // Claim Host
            if (metaHost === myPeerId && JSON.stringify(metaAddrs.sort()) === JSON.stringify(myAddresses.sort())) {
                 setStatus("I am the host (verified).");
                 return;
            }

            // Write self as host
            let storedAddrs: any = myAddresses;
            let storedCheck: any = "";
            const activeKey = authService.getKey();

            if (activeKey) {
                storedAddrs = await authService.encrypt(JSON.stringify(myAddresses), activeKey);
                storedCheck = await authService.generateValidationToken(activeKey);
            }

            const metaObj = { 
                hostId: myPeerId, 
                hostAddrs: storedAddrs,
                encrypted: !!activeKey,
                securityCheck: storedCheck,
                requiredPlugins: pluginLoader.getEnabledUniversalPlugins()
            };

            await fsService.writeFileString(metaPath, JSON.stringify(metaObj, null, 2));
            
            try {
                await fsService.pushChanges(rootPath, sshKeyPathRef.current || "");
                setStatus("Host claimed and synced.");
                deadHostIdRef.current = null;
            } catch (e) {
                 if (retryCount < 2) setTimeout(() => negotiateHost(retryCount + 1), 2000);
                 else setStatus("Host (Offline/Local)");
            }

        } catch (e) {
            console.error("Negotiation error:", e);
        } finally {
            isNegotiatingRef.current = false;
        }
    };

    negotiateHost();
  }, [rootPath, myPeerId, myAddresses, isHost]);

  return { updateProjectKey };
}