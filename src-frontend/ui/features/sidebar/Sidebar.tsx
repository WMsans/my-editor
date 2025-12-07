import React, { useState, useEffect, useCallback } from "react";
import { FileExplorer } from "../explorer/FileExplorer";
import { IncomingRequest } from "../activity/IncomingRequest";
import { useServices } from "../../contexts/ServiceContext";
import { useProjectStore } from "../../../core/stores/useProjectStore";
import { useSessionStore } from "../../../core/stores/useSessionStore";
import { useUIStore } from "../../../core/stores/useUIStore";
import { useP2P } from "../activity/useP2P";
import { SidebarWebview } from "./SidebarWebview";
import { ExtensionSidebarView } from "./ExtensionSidebarView";

import styles from "./Sidebar.module.css"; 

export const Sidebar: React.FC = () => {
  const { activeSidebarTab, setActiveSidebarTab } = useUIStore();
  const { rootPath } = useProjectStore();
  const { registry } = useServices();
  
  const { isHost, statusMessage, incomingRequest } = useSessionStore();
  const { acceptRequest, rejectRequest } = useP2P();

  const [width, setWidth] = useState(250);
  const [isResizing, setIsResizing] = useState(false);

  const handleAcceptRequest = async () => {
      if (rootPath) await acceptRequest(rootPath);
  };

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
  
  // Data
  const pluginTabs = registry.getSidebarTabs();
  const viewContainers = registry.getViewContainers();

  const renderContent = () => {
    if (activeSidebarTab === "files") {
      return <FileExplorer />;
    }
    if (activeSidebarTab === "p2p") {
      return (
        <div className="p2p-panel" style={{ padding: '10px' }}>
          <h3>P2P Status: {isHost ? "Host" : "Guest"}</h3>
          <p className="status-text">{statusMessage}</p>
          {incomingRequest && (
            <IncomingRequest 
              peerId={incomingRequest} 
              onAccept={handleAcceptRequest} 
              onReject={() => rejectRequest()} 
            />
          )}
        </div>
      );
    }
    
    // Legacy Plugin Panels
    const plugin = pluginTabs.find(t => t.id === activeSidebarTab);
    if (plugin) {
      const Component = plugin.component;
      return <div className={styles.pluginPanel}><Component /></div>;
    }

    // View Containers
    const container = viewContainers.find(c => c.id === activeSidebarTab);
    if (container) {
        const views = registry.getViews(container.id);
        return (
            <div className={styles.pluginPanel}>
                <div className={styles.panelHeader}>{container.title.toUpperCase()}</div>
                
                {views.length === 0 && <div className={styles.sidebarEmpty}>No views registered.</div>}
                
                {views.map(view => {
                    if (view.type === 'webview') {
                         const options = registry.getWebviewView(view.id);
                         if (!options) return <div key={view.id} className={styles.sidebarEmpty}>Loading {view.name}...</div>;
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
    <aside className={styles.container} style={{ width: `${width}px` }}>
      <div className={styles.activityBar}>
        
        <div 
            className={`${styles.activityIcon} ${activeSidebarTab === 'files' ? styles.active : ''}`} 
            onClick={() => setActiveSidebarTab('files')} 
            title="Explorer"
        >📂</div>

        <div 
            className={`${styles.activityIcon} ${activeSidebarTab === 'p2p' ? styles.active : ''}`} 
            onClick={() => setActiveSidebarTab('p2p')} 
            title="Collaboration"
        >📡</div>

        {pluginTabs.map(tab => (
           <div 
                key={tab.id} 
                className={`${styles.activityIcon} ${activeSidebarTab === tab.id ? styles.active : ''}`} 
                onClick={() => setActiveSidebarTab(tab.id)} 
                title={tab.label}
            >
                {tab.icon}
            </div>
        ))}

        {viewContainers.map(container => (
            <div 
                key={container.id} 
                className={`${styles.activityIcon} ${activeSidebarTab === container.id ? styles.active : ''}`} 
                onClick={() => setActiveSidebarTab(container.id)} 
                title={container.title}
            >
                {container.icon}
            </div>
        ))}

      </div>

      <div 
        className={styles.sidePanel} 
        style={{ pointerEvents: isResizing ? 'none' : 'auto' }}
      >
         {renderContent()}
      </div>

      <div 
        className={`${styles.resizer} ${isResizing ? styles.active : ''}`} 
        onMouseDown={startResizing} 
      />
    </aside>
  );
};