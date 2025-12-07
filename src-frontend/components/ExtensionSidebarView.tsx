import React, { useState, useEffect } from "react";
import { useServices } from "../contexts/ServiceContext";
import { useTreeData } from "../hooks/useTreeView";
import { TreeNode } from "./ui/TreeNode";

// --- Recursive Container Component ---
const SmartTreeItem: React.FC<{
  viewId: string;
  item: any;
  depth: number;
}> = ({ viewId, item, depth }) => {
  const { commandService } = useServices();
  const [expanded, setExpanded] = useState(item.collapsibleState === "expanded");
  
  // Use the hook for children data
  const { items: children, loading, fetchData } = useTreeData(viewId, item);

  const isExpandable =
    item.collapsibleState === "collapsed" ||
    item.collapsibleState === "expanded";

  // Lazy load children when expanded
  useEffect(() => {
    if (expanded && children.length === 0 && isExpandable) {
      fetchData();
    }
  }, [expanded, isExpandable]);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isExpandable) setExpanded(!expanded);
  };

  const handleClick = () => {
    if (item.command) {
      commandService.executeCommand(item.command.command, item.command.arguments);
    } else {
        // Default behavior for folders is to toggle
        if (isExpandable) setExpanded(!expanded);
    }
  };

  return (
    <TreeNode
      label={item.label}
      icon={item.icon}
      description={item.description}
      depth={depth}
      isExpandable={isExpandable}
      isExpanded={expanded}
      isLoading={loading}
      onClick={handleClick}
      onToggleExpand={handleToggle}
    >
      {children.map((child, idx) => (
        <SmartTreeItem 
          key={child.id || idx} 
          viewId={viewId} 
          item={child} 
          depth={depth + 1} 
        />
      ))}
    </TreeNode>
  );
};

// --- Main View Component ---
interface ExtensionSidebarViewProps {
  viewId: string;
  name: string;
}

export const ExtensionSidebarView: React.FC<ExtensionSidebarViewProps> = ({
  viewId,
  name,
}) => {
  // Use hook for root items (undefined parent)
  const { items: rootItems, loading, error } = useTreeData(viewId, undefined);

  return (
    <div className="extension-view">
      <div className="view-header" style={{ 
          padding: '5px 15px', 
          background: '#313244', 
          fontSize: '0.8rem', 
          fontWeight: 'bold',
          display: 'flex',
          justifyContent: 'space-between'
      }}>
        <span>{name.toUpperCase()}</span>
      </div>
      
      <div className="view-content" style={{ padding: '5px 0' }}>
        {error && <div className="error-msg" style={{color: '#f38ba8', padding: '10px'}}>{error}</div>}
        
        {loading && rootItems.length === 0 && (
            <div style={{padding: '10px', color: '#6c7086'}}>Loading view...</div>
        )}

        {!loading && rootItems.length === 0 && !error && (
            <div className="sidebar-empty">No items provided by plugin.</div>
        )}

        {rootItems.map((item, idx) => (
          <SmartTreeItem 
            key={item.id || idx} 
            viewId={viewId} 
            item={item} 
            depth={0} 
          />
        ))}
      </div>
    </div>
  );
};