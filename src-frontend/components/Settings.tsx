import React, { useState, useEffect } from "react";
import { useProjectStore } from "../stores/useProjectStore";
import { useUIStore } from "../stores/useUIStore";

export const Settings: React.FC = () => {
  const { isSettingsOpen, setShowSettings } = useUIStore();
  const { sshKeyPath, setSshKeyPath, encryptionKey, setEncryptionKey, detectedRemote } = useProjectStore();

  const [localSshPath, setLocalSshPath] = useState(sshKeyPath);
  const [localEncKey, setLocalEncKey] = useState(encryptionKey);

  useEffect(() => {
    if (isSettingsOpen) {
      setLocalSshPath(sshKeyPath);
      setLocalEncKey(encryptionKey);
    }
  }, [isSettingsOpen, sshKeyPath, encryptionKey]);

  if (!isSettingsOpen) return null;

  const generateKey = () => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
    let result = "";
    for (let i = 0; i < 32; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setLocalEncKey(result);
  };

  const handleSave = () => {
    setSshKeyPath(localSshPath);
    setEncryptionKey(localEncKey);
    setShowSettings(false);
  };

  return (
    <div className="settings-overlay" onClick={() => setShowSettings(false)}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Settings</h3>
        
        <div className="setting-group">
          <label>SSH Private Key Path (Optional)</label>
          <input type="text" value={localSshPath} onChange={(e) => setLocalSshPath(e.target.value)} placeholder="/Users/username/.ssh/id_rsa"/>
          <small>Leave empty to use <code>~/.ssh/config</code> or SSH Agent.</small>
        </div>

        <div className="setting-group">
          <label>IP Encryption Key (Optional)</label>
          <div className="row">
            <input type="password" value={localEncKey} onChange={(e) => setLocalEncKey(e.target.value)} placeholder="Enter secret key..."/>
            <button onClick={generateKey} style={{ whiteSpace: 'nowrap' }}>Generate</button>
          </div>
          <small>If set, your IP address in the project file will be encrypted.</small>
        </div>

        {detectedRemote && (
          <div className="setting-group">
             <label>Detected Remote Origin</label>
             <input disabled value={detectedRemote} style={{ opacity: 0.7 }} />
          </div>
        )}

        <div className="actions">
          <button onClick={handleSave} style={{ marginRight: "10px", background: "#89b4fa", color: "#1e1e2e" }}>Save Changes</button>
          <button onClick={() => setShowSettings(false)} className="btn-close">Cancel</button>
        </div>
      </div>
    </div>
  );
};