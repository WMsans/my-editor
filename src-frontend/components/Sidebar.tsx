import React from "react";
import { FileExplorer } from "./FileExplorer";
import { IncomingRequest } from "./IncomingRequest";

interface SidebarProps {
  rootPath: string;
  onOpenFile: (path: string) => void;
  fileSystemRefresh: number;
  isHost: boolean;
  status: string;
  incomingRequest: string | null;
  onAcceptRequest: () => void;
  onRejectRequest: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  rootPath,
  onOpenFile,
  fileSystemRefresh,
  isHost,
  status,
  incomingRequest,
  onAcceptRequest,
  onRejectRequest
}) => {
  return (
    <aside className="sidebar">
      <FileExplorer 
        rootPath={rootPath} 
        onOpenFile={onOpenFile} 
        refreshTrigger={fileSystemRefresh} 
      />
      
      <div className="p2p-panel">
        <h3>P2P Status: {isHost ? "Host" : "Guest"}</h3>
        <p className="status-text">{status}</p>
        
        {incomingRequest && (
          <IncomingRequest 
            peerId={incomingRequest} 
            onAccept={onAcceptRequest} 
            onReject={onRejectRequest} 
          />
        )}
      </div>
    </aside>
  );
};