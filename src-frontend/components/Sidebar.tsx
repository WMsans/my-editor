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
  
  // Legacy Tabs
  const pluginTabs = registry.getSidebarTabs();
  
  // [PHASE 1] Static Containers
  const viewContainers = registry.getViewContainers();

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
    
    // Legacy Plugin Panels (Loaded Components)
    const plugin = pluginTabs.find(t => t.id === activeTab);
    if (plugin) {
      const Component = plugin.component;
      return <div className="plugin-panel"><Component /></div>;
    }

    // [PHASE 1] Static Views (Data Driven)
    const container = viewContainers.find(c => c.id === activeTab);
    if (container) {
        const views = registry.getViews(container.id);
        return (
            <div className="plugin-panel">
                <div className="sidebar-header">{container.title.toUpperCase()}</div>
                {views.length === 0 && <div className="sidebar-empty">No views registered.</div>}
                
                {views.map(view => (
                    <div key={view.id} className="view-pane" style={{ borderTop: '1px solid #313244' }}>
                        <div className="view-header" style={{ padding: '5px 15px', background: '#313244', fontSize: '0.8rem', fontWeight: 'bold' }}>
                            {view.name.toUpperCase()}
                        </div>
                        <div className="view-content" style={{ padding: '10px' }}>
                            <small style={{ color: '#6c7086' }}>
                                View content not loaded (Phase 1)
                            </small>
                        </div>
                    </div>
                ))}
            </div>
        );
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

        {/* Legacy Plugin Icons */}
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

        {/* [PHASE 1] Static View Containers */}
        {viewContainers.map(container => (
            <div
             key={container.id}
             className={`activity-icon ${activeTab === container.id ? 'active' : ''}`} 
             onClick={() => setActiveTab(container.id)}
             title={container.title}
             style={{ cursor: 'pointer', padding: '10px', opacity: activeTab === container.id ? 1 : 0.5, fontSize: '1.2rem' }}
           >
             {container.icon}
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