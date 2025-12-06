import React, { useState, useEffect } from "react";
import { pluginLoader } from "../mod-engine/PluginLoader";
import { registry } from "../mod-engine/Registry";

// --- The Recursive Node Component ---
const GenericTreeItem: React.FC<{
  viewId: string;
  item: any; // Changed from TreeItem to any to handle hybrid data+UI object
  depth: number;
}> = ({ viewId, item, depth }) => {
  const [expanded, setExpanded] = useState(
    item.collapsibleState === "expanded"
  );
  const [children, setChildren] = useState<any[]>([]); // Changed to any[]
  const [loading, setLoading] = useState(false);

  const isExpandable =
    item.collapsibleState === "collapsed" ||
    item.collapsibleState === "expanded";

  const fetchChildren = async () => {
    setLoading(true);
    try {
      // 1. Get raw data children
      const rawChildren = await pluginLoader.requestTreeViewData(viewId, item);
      
      if (Array.isArray(rawChildren)) {
        // 2. Resolve UI properties for each child
        const resolved = await Promise.all(rawChildren.map(async (child: any) => {
            const ui = await pluginLoader.resolveTreeItem(viewId, child);
            // Merge raw data (for logic) with UI properties (for display)
            return { ...child, ...(ui as any) };
        }));
        setChildren(resolved);
      }
    } catch (e) {
      console.error("Failed to fetch tree children", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (expanded && children.length === 0 && isExpandable) {
      fetchChildren();
    }
  }, [expanded]);

  const handleClick = () => {
    if (isExpandable) {
      setExpanded(!expanded);
    }
    // Handle Command Click
    if (item.command) {
      registry.executeCommand(item.command.command, item.command.arguments);
    }
  };

  return (
    <div className="generic-tree-node">
      <div
        className="tree-label"
        style={{ paddingLeft: `${depth * 12 + 10}px` }}
        onClick={handleClick}
      >
        <span className="icon">
          {isExpandable ? (expanded ? "📂" : "📁") : item.icon || "📄"}
        </span>
        <span className="text">
            {item.label}
            {item.description && <span className="desc">{item.description}</span>}
        </span>
      </div>
      
      {expanded && (
        <div className="tree-children">
            {loading && <div style={{paddingLeft: `${(depth+1)*12}px`, fontSize:'0.8em', color: '#6c7086'}}>Loading...</div>}
            {children.map((child, idx) => (
                <GenericTreeItem 
                    key={child.id || idx} 
                    viewId={viewId} 
                    item={child} 
                    depth={depth + 1} 
                />
            ))}
        </div>
      )}
    </div>
  );
};

// --- The Main View Container ---
interface ExtensionSidebarViewProps {
  viewId: string;
  name: string;
}

export const ExtensionSidebarView: React.FC<ExtensionSidebarViewProps> = ({
  viewId,
  name,
}) => {
  const [rootItems, setRootItems] = useState<any[]>([]); // Changed to any[]
  const [error, setError] = useState<string | null>(null);

  // Initial Load (Root Level)
  useEffect(() => {
    let mounted = true;
    const loadRoot = async () => {
      try {
        // 1. Fetch root raw objects
        const rawRoots = await pluginLoader.requestTreeViewData(viewId);
        
        if (mounted) {
            if (Array.isArray(rawRoots)) {
                // 2. Resolve UI properties
                const resolved = await Promise.all(rawRoots.map(async (child: any) => {
                    const ui = await pluginLoader.resolveTreeItem(viewId, child);
                    return { ...child, ...(ui as any) };
                }));
                setRootItems(resolved);
            }
        }
      } catch (e: any) {
        if (mounted) setError(e.toString());
      }
    };
    loadRoot();
    return () => { mounted = false; };
  }, [viewId]);

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
        
        {rootItems.length === 0 && !error && (
            <div className="sidebar-empty">No items provided by plugin.</div>
        )}

        {rootItems.map((item, idx) => (
          <GenericTreeItem 
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