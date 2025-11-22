import React, { useState, useEffect } from "react";

interface SettingsProps {
  isOpen: boolean;
  onClose: () => void;
  sshKeyPath: string;
  setSshKeyPath: (path: string) => void;
  remoteUrl: string;
  setRemoteUrl: (url: string) => void;
  onSaveRemote: () => void;
}

export const Settings: React.FC<SettingsProps> = ({
  isOpen,
  onClose,
  sshKeyPath,
  setSshKeyPath,
  remoteUrl,
  setRemoteUrl,
  onSaveRemote
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
          <label>Remote Origin URL (Current Folder)</label>
          <div className="row">
            <input 
              type="text" 
              value={remoteUrl} 
              onChange={(e) => setRemoteUrl(e.target.value)} 
              placeholder="git@github.com:user/repo.git"
            />
            <button onClick={onSaveRemote}>Set Remote</button>
          </div>
        </div>

        <div className="actions">
          <button onClick={onClose} className="btn-close">Close</button>
        </div>
      </div>
    </div>
  );
};