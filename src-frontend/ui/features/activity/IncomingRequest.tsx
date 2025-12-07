import React from "react";

interface IncomingRequestProps {
  peerId: string;
  onAccept: () => void;
  onReject: () => void;
}

export const IncomingRequest: React.FC<IncomingRequestProps> = ({
  peerId,
  onAccept,
  onReject,
}) => {
  return (
    <div className="request-card">
      <p><strong>{peerId.slice(0, 8)}...</strong> wants to join.</p>
      <div className="actions">
        <button onClick={onAccept} className="btn-accept">Accept</button>
        <button onClick={onReject} className="btn-reject">Reject</button>
      </div>
    </div>
  );
};