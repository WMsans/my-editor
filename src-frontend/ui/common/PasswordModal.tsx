import React, { useState, useEffect } from "react";
import { useUIStore } from "../../core/stores/useUIStore";

export const PasswordModal: React.FC = () => {
  const { passwordRequest, resolvePasswordRequest } = useUIStore();
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (passwordRequest) setPassword("");
  }, [passwordRequest]);

  if (!passwordRequest) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    resolvePasswordRequest(password);
  };

  return (
    <div className="settings-overlay">
      <div className="settings-modal" style={{ width: "350px", borderColor: "#89b4fa" }}>
        <h3 style={{ color: "#89b4fa" }}>🔐 Decryption Required</h3>
        <p style={{ color: "#cdd6f4", fontSize: "0.9rem", marginBottom: "20px", whiteSpace: "pre-line" }}>{passwordRequest.message}</p>
        <form onSubmit={handleSubmit}>
          <div className="setting-group">
            <input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter decryption key..." style={{ width: "100%", padding: "12px", fontSize: "1rem" }} />
          </div>
          <div className="actions">
            <button type="submit" style={{ marginRight: "10px", background: "#89b4fa", color: "#1e1e2e", fontWeight: "bold" }}>Unlock Project</button>
            <button type="button" onClick={() => resolvePasswordRequest(null)} className="btn-close">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
};