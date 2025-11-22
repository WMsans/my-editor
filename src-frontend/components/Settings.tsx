import React from "react";

interface SettingsProps {
  isOpen: boolean;
  onClose: () => void;
  sshKeyPath: string;
  setSshKeyPath: (path: string) => void;
  detectedRemote: string;
}

export const Settings: React.FC<SettingsProps> = ({
  isOpen,
  onClose,
  sshKeyPath,
  setSshKeyPath,
  detectedRemote
}) => {
  if (!isOpen) return null;

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Settings</h3>
        
        <div className="setting-group">
          <label>SSH Private Key Path (Absolute Path)</label>
          <input 
            type="text" 
            value={sshKeyPath} 
            onChange={(e) => setSshKeyPath(e.target.value)} 
            placeholder="/Users/username/.ssh/id_rsa"
          />
          <small>Required for pushing to remote (GitHub/GitLab)</small>
        </div>

        <div className="setting-group">
          <label>SSH Private Key Path (Optional)</label> {/* Added Optional */}
          <input 
            type="text" 
            value={sshKeyPath} 
            onChange={(e) => setSshKeyPath(e.target.value)} 
            placeholder="/Users/username/.ssh/id_rsa"
          />
          <small>
            Leave empty to use <code>~/.ssh/config</code> or SSH Agent.
          </small>
        </div>

        <div className="actions">
          <button onClick={onClose} className="btn-close">Close</button>
        </div>
      </div>
    </div>
  );
};