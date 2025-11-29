import React, { useState, useEffect } from "react";

interface SettingsProps {
  isOpen: boolean;
  onClose: () => void;
  sshKeyPath: string;
  setSshKeyPath: (path: string) => void;
  encryptionKey: string;
  updateProjectKey: (key: string) => void; // [CHANGED] Replaced setEncryptionKey
  detectedRemote: string;
}

export const Settings: React.FC<SettingsProps> = ({
  isOpen,
  onClose,
  sshKeyPath,
  setSshKeyPath,
  encryptionKey,
  updateProjectKey,
  detectedRemote
}) => {
  // Local state for deferred saving
  const [localSshPath, setLocalSshPath] = useState(sshKeyPath);
  const [localEncKey, setLocalEncKey] = useState(encryptionKey);

  // Reset local state when opening
  useEffect(() => {
    if (isOpen) {
      setLocalSshPath(sshKeyPath);
      setLocalEncKey(encryptionKey);
    }
  }, [isOpen, sshKeyPath, encryptionKey]);

  if (!isOpen) return null;

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
    // [CHANGED] Use the update handler which triggers re-encryption and push
    if (localEncKey !== encryptionKey) {
        updateProjectKey(localEncKey);
    }
    onClose();
  };

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Settings</h3>
        
        <div className="setting-group">
          <label>SSH Private Key Path (Optional)</label>
          <input 
            type="text" 
            value={localSshPath} 
            onChange={(e) => setLocalSshPath(e.target.value)} 
            placeholder="/Users/username/.ssh/id_rsa"
          />
          <small>
            Leave empty to use <code>~/.ssh/config</code> or SSH Agent.
          </small>
        </div>

        <div className="setting-group">
          <label>Project Encryption Key</label>
          <div className="row">
            <input 
              type="text" // Changed to text so user can see the key they are setting
              value={localEncKey} 
              onChange={(e) => setLocalEncKey(e.target.value)} 
              placeholder="Enter secret key..."
            />
            <button onClick={generateKey} style={{ whiteSpace: 'nowrap' }}>Generate</button>
          </div>
          <small>
            This key will be stored in the project file and used to encrypt your IP address.
            Changing this will immediately push a new meta file to the remote.
          </small>
        </div>

        {detectedRemote && (
          <div className="setting-group">
             <label>Detected Remote Origin</label>
             <input disabled value={detectedRemote} style={{ opacity: 0.7 }} />
          </div>
        )}

        <div className="actions">
          <button 
            onClick={handleSave} 
            style={{ marginRight: "10px", background: "#89b4fa", color: "#1e1e2e" }}
          >
            Save Changes
          </button>
          <button onClick={onClose} className="btn-close">Cancel</button>
        </div>
      </div>
    </div>
  );
};