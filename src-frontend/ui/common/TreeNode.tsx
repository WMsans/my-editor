import React from "react";

export interface TreeNodeProps {
  label: string;
  icon?: string;
  description?: string;
  depth: number;
  isExpandable: boolean;
  isExpanded: boolean;
  isLoading: boolean;
  onClick: () => void;
  onToggleExpand: (e: React.MouseEvent) => void;
  children?: React.ReactNode;
}

/**
 * Pure Presentation Component for a Tree Node.
 * Knows nothing about plugins, loaders, or commands.
 */
export const TreeNode: React.FC<TreeNodeProps> = ({
  label,
  icon,
  description,
  depth,
  isExpandable,
  isExpanded,
  isLoading,
  onClick,
  onToggleExpand,
  children
}) => {
  return (
    <div className="generic-tree-node">
      <div
        className="tree-label"
        style={{ paddingLeft: `${depth * 12 + 10}px` }}
        onClick={onClick}
      >
        <span 
          className="icon" 
          onClick={isExpandable ? onToggleExpand : undefined}
          style={{ cursor: isExpandable ? 'pointer' : 'default' }}
        >
          {isExpandable ? (isExpanded ? "📂" : "📁") : icon || "📄"}
        </span>
        <span className="text">
            {label}
            {description && <span className="desc">{description}</span>}
        </span>
      </div>
      
      {isExpanded && (
        <div className="tree-children">
            {isLoading && (
              <div style={{
                paddingLeft: `${(depth + 1) * 12 + 10}px`, 
                fontSize: '0.8em', 
                color: '#6c7086',
                paddingTop: '2px'
              }}>
                Loading...
              </div>
            )}
            {children}
        </div>
      )}
    </div>
  );
};