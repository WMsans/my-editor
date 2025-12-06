import React from "react";
import { useUIStore } from "../stores/useUIStore";

interface WarningModalProps {
  onConfirm?: () => void;
  confirmText?: string;
}

export const WarningModal: React.FC<WarningModalProps> = ({ onConfirm, confirmText }) => {
  const { warningMsg, setWarningMsg } = useUIStore();

  if (!warningMsg) return null;

  return (
    <div className="settings-overlay" onClick={() => setWarningMsg(null)}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()} style={{ borderColor: "#f38ba8" }}>
        <h3 style={{ color: "#f38ba8", display: "flex", alignItems: "center", gap: "8px" }}>⚠️ Warning</h3>
        <div className="warning-content" style={{ marginBottom: "20px" }}>{warningMsg}</div>
        <div className="actions">
          {onConfirm && (
            <button onClick={onConfirm} style={{ marginRight: "10px", background: "#f38ba8", color: "#1e1e2e" }}>{confirmText || "Confirm"}</button>
          )}
          <button onClick={() => setWarningMsg(null)} className="btn-close">Close</button>
        </div>
      </div>
    </div>
  );
};