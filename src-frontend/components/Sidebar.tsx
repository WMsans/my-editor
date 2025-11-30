import React, { useState } from "react";
import { FileExplorer } from "./FileExplorer";
import { IncomingRequest } from "./IncomingRequest";
import { registry } from "../mod-engine/Registry";

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
  const [activeTab, setActiveTab] = useState("files");
  const pluginTabs = registry.getSidebarTabs();

  // Standard Panels
  const renderContent = () => {
    if (activeTab === "files") {
      return (
        <FileExplorer 
          rootPath={rootPath} 
          onOpenFile={onOpenFile} 
          refreshTrigger={fileSystemRefresh} 
        />
      );
    }
    if (activeTab === "p2p") {
      return (
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
      );
    }
    
    // Plugin Panels
    const plugin = pluginTabs.find(t => t.id === activeTab);
    if (plugin) {
      const Component = plugin.component;
      return <div className="plugin-panel"><Component /></div>;
    }
    
    return null;
  };

  return (
    <aside className="sidebar-container" style={{ display: 'flex', width: '250px', borderRight: '1px solid #313244' }}>
      {/* Activity Bar (Left Strip) */}
      <div className="activity-bar" style={{ width: '48px', background: '#11111b', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: '10px', borderRight: '1px solid #313244' }}>
        
        <div 
          className={`activity-icon ${activeTab === 'files' ? 'active' : ''}`} 
          onClick={() => setActiveTab('files')}
          title="Explorer"
          style={{ cursor: 'pointer', padding: '10px', opacity: activeTab === 'files' ? 1 : 0.5, fontSize: '1.2rem' }}
        >
          📂
        </div>

        <div 
          className={`activity-icon ${activeTab === 'p2p' ? 'active' : ''}`} 
          onClick={() => setActiveTab('p2p')}
          title="Collaboration"
          style={{ cursor: 'pointer', padding: '10px', opacity: activeTab === 'p2p' ? 1 : 0.5, fontSize: '1.2rem' }}
        >
          📡
        </div>

        {/* Plugin Icons */}
        {pluginTabs.map(tab => (
           <div 
             key={tab.id}
             className={`activity-icon ${activeTab === tab.id ? 'active' : ''}`} 
             onClick={() => setActiveTab(tab.id)}
             title={tab.label}
             style={{ cursor: 'pointer', padding: '10px', opacity: activeTab === tab.id ? 1 : 0.5, fontSize: '1.2rem' }}
           >
             {tab.icon}
           </div>
        ))}
      </div>

      {/* Side Panel Content */}
      <div className="side-panel" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#181825' }}>
         {renderContent()}
      </div>
    </aside>
  );
};