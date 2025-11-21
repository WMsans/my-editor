import React from "react";

interface PeerListProps {
  peers: string[];
  onJoin: (id: string) => void;
}

export const PeerList: React.FC<PeerListProps> = ({ peers, onJoin }) => {
  return (
    <div style={{ marginBottom: "1rem" }}>
      <h3>Peers</h3>
      <div className="row" style={{ gap: "10px", flexWrap: "wrap" }}>
        {peers.length === 0 && <small>Scanning...</small>}
        {peers.map((peer) => (
          <div key={peer} className="peer-card">
            <span>{peer.slice(0, 6)}... </span>
            <button onClick={() => onJoin(peer)}>Join</button>
          </div>
        ))}
      </div>
    </div>
  );
};