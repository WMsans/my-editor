import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { pluginLoader } from "../mod-engine/PluginLoader";

const META_FILE = ".collab_meta.json";
const VALIDATION_TOKEN = "COLLAB_ACCESS_GRANTED_V1";

// --- Simple Crypto Helpers ---
const ENC = new TextEncoder();
const DEC = new TextDecoder();

const getKey = async (password: string) => {
  const keyMaterial = await window.crypto.subtle.importKey("raw", ENC.encode(password), "PBKDF2", false, ["deriveKey"]);
  // Using a fixed salt for simplicity in this file-based demo.
  return window.crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: ENC.encode("COLLAB_FIXED_SALT_V1"), iterations: 100000, hash: "SHA-256" },
    keyMaterial, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
  );
};

const encryptData = async (data: string, password: string): Promise<string> => {
    const key = await getKey(password);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, ENC.encode(data));
    const buf = new Uint8Array(encrypted);
    const b64 = btoa(String.fromCharCode(...buf));
    const ivHex = Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join('');
    return `${ivHex}:${b64}`;
};

const decryptData = async (cipherText: string, password: string): Promise<string> => {
    const [ivHex, dataB64] = cipherText.split(':');
    const iv = new Uint8Array(ivHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
    const data = Uint8Array.from(atob(dataB64), c => c.charCodeAt(0));
    const key = await getKey(password);
    const decrypted = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
    return DEC.decode(decrypted);
};
// -----------------------------

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
  rootPath,
  myPeerId,
  myAddresses,
  sshKeyPathRef,
  encryptionKeyRef,
  setEncryptionKey,
  isHost,
  deadHostIdRef,
  isAutoJoiningRef,
  sendJoinRequest,
  setStatus,
  setWarningMsg,
  requestPassword
}: UseHostNegotiationProps) {

  const isNegotiatingRef = useRef(false);

  // Function to update the key, write file, and push
  const updateProjectKey = async (newKey: string) => {
    if (!rootPath || !myPeerId) return;
    
    setStatus("Updating project key...");
    const sep = rootPath.includes("\\") ? "\\" : "/";
    const metaPath = `${rootPath}${sep}${META_FILE}`;
    const ssh = sshKeyPathRef.current || "";

    try {
        let storedAddrs: any = myAddresses;
        let securityCheck = "";
        
        // Encrypt with the NEW key
        if (newKey) {
            try {
                // 1. Encrypt Addresses
                storedAddrs = await encryptData(JSON.stringify(myAddresses), newKey);
                // 2. Create Validation Token (Encrypt the static string)
                securityCheck = await encryptData(VALIDATION_TOKEN, newKey);
            } catch (e) {
                console.error("Encryption failed:", e);
                setWarningMsg("Failed to encrypt data.");
                return;
            }
        }

        // [NEW] Get currently active universal plugins to enforce on guests
        const requiredPlugins = pluginLoader.getEnabledUniversalPlugins();

        const metaObj = { 
            hostId: myPeerId, 
            hostAddrs: storedAddrs,
            encrypted: !!newKey,
            securityCheck: securityCheck,
            requiredPlugins // [NEW] Save requirements
        };

        const content = new TextEncoder().encode(JSON.stringify(metaObj, null, 2));
        await invoke("write_file_content", { 
            path: metaPath, 
            content: Array.from(content)
        });

        setEncryptionKey(newKey);
        encryptionKeyRef.current = newKey;

        await invoke("push_changes", { path: rootPath, sshKeyPath: ssh });
        setStatus("Key updated & pushed.");
    } catch (e: any) {
        setWarningMsg(`Failed to update key: ${e.toString()}`);
    }
  };

  // [FIX] We move negotiateHost inside useEffect or ensure it depends on isHost
  useEffect(() => {
    if (!rootPath || !myPeerId) return;

    // [CRITICAL FIX] If we are already a guest (isHost === false), DO NOT run negotiation.
    // This prevents the loop where opening the folder triggers "auto-join" again.
    if (!isHost) return;

    const negotiateHost = async (retryCount = 0) => {
        if (retryCount === 0 && isNegotiatingRef.current) return;
        
        isNegotiatingRef.current = true;

        try {
            setStatus(retryCount > 0 ? `Negotiating (Attempt ${retryCount + 1})...` : "Negotiating host...");
            
            const sep = rootPath.includes("\\") ? "\\": "/";
            const metaPath = `${rootPath}${sep}${META_FILE}`;
            const ssh = sshKeyPathRef.current || "";

            try {
                await invoke("git_pull", { path: rootPath, sshKeyPath: ssh });
            } catch (e) {
                console.log("Git pull skipped/failed (expected if new repo):", e);
            }
            
            let metaHost = "";
            let metaAddrs: string[] = [];
            let isEncrypted = false;
            let securityCheck = "";
            let requiredPlugins: string[] = []; // [NEW]

            try {
                const contentBytes = await invoke<number[]>("read_file_content", { path: metaPath });
                const content = new TextDecoder().decode(new Uint8Array(contentBytes));
                const json = JSON.parse(content);
                
                metaHost = json.hostId;
                isEncrypted = json.encrypted || false;
                securityCheck = json.securityCheck || "";
                requiredPlugins = json.requiredPlugins || []; // [NEW] Read requirements

                if (isEncrypted) {
                    let decrypted = false;
                    
                    // 1. Try already active key
                    let currentKey = encryptionKeyRef.current;
                    
                    if (currentKey) {
                        try {
                            const val = await decryptData(securityCheck, currentKey);
                            if (val === VALIDATION_TOKEN) {
                                if (json.hostAddrs && typeof json.hostAddrs === 'string') {
                                    const decryptedJsonStr = await decryptData(json.hostAddrs, currentKey);
                                    metaAddrs = JSON.parse(decryptedJsonStr);
                                } else {
                                    metaAddrs = [];
                                }
                                decrypted = true;
                            }
                        } catch (e) { 
                            setEncryptionKey("");
                            encryptionKeyRef.current = "";
                        }
                    }

                    // 2. If not decrypted, prompt user
                    let retryMessage = "";
                    while (!decrypted) {
                        const msg = retryMessage || "🔒 Project Encrypted.\nPlease enter the decryption key:";
                        const userInput = await requestPassword(msg);
                        
                        if (userInput === null) {
                            setStatus("Decryption cancelled. Offline.");
                            return; 
                        }
                        
                        try {
                            const val = await decryptData(securityCheck, userInput);
                            if (val === VALIDATION_TOKEN) {
                                if (json.hostAddrs && typeof json.hostAddrs === 'string') {
                                    try {
                                        const decryptedJsonStr = await decryptData(json.hostAddrs, userInput);
                                        metaAddrs = JSON.parse(decryptedJsonStr);
                                    } catch (e) {
                                        metaAddrs = [];
                                    }
                                } else {
                                    metaAddrs = [];
                                }
                                decrypted = true;
                                setEncryptionKey(userInput); 
                                encryptionKeyRef.current = userInput; 
                            } else {
                                throw new Error("Validation mismatch");
                            }
                        } catch (e) {
                            retryMessage = "⛔ Incorrect key. Please try again.";
                        }
                    }
                } else {
                    metaAddrs = json.hostAddrs || [];
                }

            } catch (e) {
                console.log("Meta file missing, invalid, or read error.", e);
            }

            if (metaHost && metaHost !== myPeerId) {
                if (deadHostIdRef.current && metaHost === deadHostIdRef.current) {
                    console.log("Ignoring disconnected host ID in meta file.");
                } else {
                    // [CRITICAL FIX] Verify we are not the host before trying to join.
                    // Since we are inside the hook, we check the prop 'isHost'.
                    // Note: The early return at the top of useEffect catches most cases,
                    // but this is a double safety check.
                    if (!isHost) {
                        console.log("Already guest, skipping auto-join.");
                        return;
                    }

                    // [NEW] Validate Required Plugins
                    const missing = pluginLoader.checkMissingRequirements(requiredPlugins);
                    if (missing.length > 0) {
                        setWarningMsg(`Cannot join session.\n\nMissing universally required plugins:\n- ${missing.join('\n- ')}\n\nPlease install/enable them and try again.`);
                        setStatus("Missing Plugins");
                        return;
                    }

                    setStatus(`Found host ${metaHost.slice(0,8)}. Joining...`);
                    isAutoJoiningRef.current = true; 
                    sendJoinRequest(metaHost, metaAddrs || []);
                    return; 
                }
            }

            if (metaHost === myPeerId) {
                 const sortedSaved = [...metaAddrs || []].sort();
                 const sortedCurrent = [...myAddresses].sort();
                 
                 if (JSON.stringify(sortedSaved) === JSON.stringify(sortedCurrent)) {
                     setStatus("I am the host (verified).");
                     return; 
                 }
                 setStatus("Updating host addresses...");
            }

            // WRITE LOGIC
            let storedAddrs: any = myAddresses;
            let storedCheck: any = securityCheck;
            const activeKey = encryptionKeyRef.current;
            const isSecure = !!activeKey;
            const myUniversalPlugins = pluginLoader.getEnabledUniversalPlugins();

            if (isSecure) {
                try {
                    storedAddrs = await encryptData(JSON.stringify(myAddresses), activeKey);
                    storedCheck = await encryptData(VALIDATION_TOKEN, activeKey);
                } catch (e) {
                    console.error("Encryption failed during save:", e);
                    setWarningMsg("Failed to encrypt IP addresses. Saving unencrypted.");
                }
            }

            const metaObj = { 
                hostId: myPeerId, 
                hostAddrs: storedAddrs,
                encrypted: isSecure,
                securityCheck: storedCheck,
                requiredPlugins: myUniversalPlugins // [NEW] Write requirements
            };

            const content = new TextEncoder().encode(JSON.stringify(metaObj, null, 2));
            await invoke("write_file_content", { 
                path: metaPath, 
                content: Array.from(content)
            });

            try {
                await invoke("push_changes", { path: rootPath, sshKeyPath: ssh });
                setStatus("Host claimed and synced.");
                deadHostIdRef.current = null;
            } catch (e) {
                console.error("Push failed:", e);
                if (retryCount < 2) {
                    setStatus(`Push failed. Retrying... (${retryCount + 1}/2)`);
                    setTimeout(() => negotiateHost(retryCount + 1), 2000);
                } else {
                    setWarningMsg("Could not sync host status to remote.\n\nRunning in offline/local host mode.");
                    setStatus("Host (Offline/Local)");
                }
            }

        } catch (e) {
            console.error("Negotiation fatal error:", e);
        } finally {
            isNegotiatingRef.current = false;
        }
    };

    negotiateHost();
  }, [rootPath, myPeerId, myAddresses, isHost]); // [CRITICAL FIX] Added isHost dependency

  return { updateProjectKey };
}