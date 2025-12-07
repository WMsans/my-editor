import React, { useState, useEffect } from "react";
import { useUIStore } from "../../core/stores/useUIStore";

export const InputModal: React.FC = () => {
  const { inputRequest, resolveInputRequest } = useUIStore();
  const [value, setValue] = useState("");

  useEffect(() => {
    if (inputRequest) {
      setValue(inputRequest.defaultValue || "");
    }
  }, [inputRequest]);

  if (!inputRequest) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    resolveInputRequest(value);
  };

  return (
    <div className="settings-overlay">
      <div className="settings-modal" style={{ width: "400px", borderColor: "#89b4fa" }}>
        <h3 style={{ color: "#89b4fa" }}>{inputRequest.message}</h3>
        <form onSubmit={handleSubmit}>
          <div className="setting-group">
            <input 
              type="text" 
              autoFocus 
              value={value} 
              onChange={(e) => setValue(e.target.value)} 
              placeholder="Enter text..." 
              style={{ width: "100%", padding: "12px", fontSize: "1rem" }} 
            />
          </div>
          <div className="actions">
            <button type="submit" style={{ marginRight: "10px", background: "#89b4fa", color: "#1e1e2e", fontWeight: "bold" }}>OK</button>
            <button type="button" onClick={() => resolveInputRequest(null)} className="btn-close">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
};