import React, { useState, useEffect, useCallback } from "react";
import { FileExplorer } from "./FileExplorer";
import { IncomingRequest } from "./IncomingRequest";
import { registry } from "../mod-engine/Registry";
import { ExtensionSidebarView } from "./ExtensionSidebarView"; 
import { SidebarWebview } from "./SidebarWebview"; 
import { useProjectStore } from "../stores/useProjectStore";
import { useSessionStore } from "../stores/useSessionStore"; // [CHANGED]
import { useUIStore } from "../stores/useUIStore";
import { useP2P } from "../hooks/useP2P"; // Re-using the fixed hook

export const Sidebar: React.FC = () => {
  const { activeSidebarTab, setActiveSidebarTab } = useUIStore();
  const { rootPath } = useProjectStore();
  
  // [CHANGED] Use SessionStore
  const { 
    isHost, statusMessage, incomingRequest
  } = useSessionStore();

  const { acceptRequest, rejectRequest } = useP2P();

  const [width, setWidth] = useState(250);
  const [isResizing, setIsResizing] = useState(false);

  const handleAcceptRequest = async () => {
      if (rootPath) await acceptRequest(rootPath);
  };

  const handleRejectRequest = () => rejectRequest();

  // Resize Logic
  const startResizing = useCallback(() => setIsResizing(true), []);
  const stopResizing = useCallback(() => setIsResizing(false), []);

  const resize = useCallback(
    (mouseMoveEvent: MouseEvent) => {
      if (isResizing) {
        const newWidth = mouseMoveEvent.clientX;
        if (newWidth > 100 && newWidth < 600) {
          setWidth(newWidth);
        }
      }
    },
    [isResizing]
  );

  useEffect(() => {
    if (isResizing) {
      window.addEventListener("mousemove", resize);
      window.addEventListener("mouseup", stopResizing);
    }
    return () => {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stopResizing);
    };
  }, [isResizing, resize, stopResizing]);
  
  const pluginTabs = registry.getSidebarTabs();
  const viewContainers = registry.getViewContainers();

  const renderContent = () => {
    if (activeSidebarTab === "files") {
      return <FileExplorer />;
    }
    if (activeSidebarTab === "p2p") {
      return (
        <div className="p2p-panel">
          <h3>P2P Status: {isHost ? "Host" : "Guest"}</h3>
          <p className="status-text">{statusMessage}</p>
          {incomingRequest && (
            <IncomingRequest 
              peerId={incomingRequest} 
              onAccept={handleAcceptRequest} 
              onReject={handleRejectRequest} 
            />
          )}
        </div>
      );
    }
    
    // Legacy Plugin Panels
    const plugin = pluginTabs.find(t => t.id === activeSidebarTab);
    if (plugin) {
      const Component = plugin.component;
      return <div className="plugin-panel"><Component /></div>;
    }

    // View Containers
    const container = viewContainers.find(c => c.id === activeSidebarTab);
    if (container) {
        const views = registry.getViews(container.id);
        return (
            <div className="plugin-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                <div className="sidebar-header">{container.title.toUpperCase()}</div>
                
                {views.length === 0 && <div className="sidebar-empty">No views registered.</div>}
                
                {views.map(view => {
                    if (view.type === 'webview') {
                         const options = registry.getWebviewView(view.id);
                         if (!options) return <div key={view.id} className="sidebar-empty">Loading {view.name}...</div>;
                         return <SidebarWebview key={view.id} viewId={view.id} options={options} />;
                    }
                    return <ExtensionSidebarView key={view.id} viewId={view.id} name={view.name} />;
                })}
            </div>
        );
    }
    return null;
  };

  return (
    <aside className="sidebar-container" style={{ display: 'flex', width: `${width}px`, borderRight: '1px solid #313244', position: 'relative' }}>
      <div className="activity-bar" style={{ width: '48px', background: '#11111b', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: '10px', borderRight: '1px solid #313244' }}>
        
        <div className={`activity-icon ${activeSidebarTab === 'files' ? 'active' : ''}`} onClick={() => setActiveSidebarTab('files')} title="Explorer" style={{ cursor: 'pointer', padding: '10px', opacity: activeSidebarTab === 'files' ? 1 : 0.5, fontSize: '1.2rem' }}>📂</div>

        <div className={`activity-icon ${activeSidebarTab === 'p2p' ? 'active' : ''}`} onClick={() => setActiveSidebarTab('p2p')} title="Collaboration" style={{ cursor: 'pointer', padding: '10px', opacity: activeSidebarTab === 'p2p' ? 1 : 0.5, fontSize: '1.2rem' }}>📡</div>

        {pluginTabs.map(tab => (
           <div key={tab.id} className={`activity-icon ${activeSidebarTab === tab.id ? 'active' : ''}`} onClick={() => setActiveSidebarTab(tab.id)} title={tab.label} style={{ cursor: 'pointer', padding: '10px', opacity: activeSidebarTab === tab.id ? 1 : 0.5, fontSize: '1.2rem' }}>{tab.icon}</div>
        ))}

        {viewContainers.map(container => (
            <div key={container.id} className={`activity-icon ${activeSidebarTab === container.id ? 'active' : ''}`} onClick={() => setActiveSidebarTab(container.id)} title={container.title} style={{ cursor: 'pointer', padding: '10px', opacity: activeSidebarTab === container.id ? 1 : 0.5, fontSize: '1.2rem' }}>{container.icon}</div>
        ))}

      </div>

      <div className="side-panel" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#181825', pointerEvents: isResizing ? 'none' : 'auto' }}>
         {renderContent()}
      </div>

      <div className={`sidebar-resizer ${isResizing ? 'active' : ''}`} onMouseDown={startResizing} />
    </aside>
  );
};