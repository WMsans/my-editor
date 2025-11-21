import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

interface FileExplorerProps {
  rootPath: string;
  onOpenFile: (path: string) => void;
  refreshTrigger: number;
}

// Sort directories first, then files
const sortEntries = (entries: FileEntry[]) => {
  return entries.sort((a, b) => {
    if (a.is_dir === b.is_dir) return a.name.localeCompare(b.name);
    return a.is_dir ? -1 : 1;
  });
};

const FileNode: React.FC<{ 
  entry: FileEntry; 
  onOpenFile: (path: string) => void; 
  depth: number;
  refreshTrigger: number;
}> = ({ entry, onOpenFile, depth, refreshTrigger }) => {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileEntry[]>([]);

  const loadChildren = async () => {
    try {
      const files = await invoke<FileEntry[]>("read_directory", { path: entry.path });
      setChildren(sortEntries(files));
    } catch (e) {
      console.error("Failed to read dir", e);
    }
  };

  // Reload children when refreshTrigger changes if the folder is already open
  useEffect(() => {
    if (expanded && entry.is_dir) {
      loadChildren();
    }
  }, [refreshTrigger, expanded]);

  const toggleExpand = async () => {
    if (!entry.is_dir) {
      onOpenFile(entry.path);
      return;
    }
    
    // If opening a folder, load its children
    if (!expanded) {
      await loadChildren();
    }
    setExpanded(!expanded);
  };

  return (
    <div>
      <div 
        className="file-node" 
        onClick={(e) => { e.stopPropagation(); toggleExpand(); }}
        style={{ paddingLeft: `${depth * 12 + 10}px` }}
      >
        <span className="icon">{entry.is_dir ? (expanded ? "📂" : "📁") : "📄"}</span>
        {entry.name}
      </div>
      {expanded && entry.is_dir && (
        <div>
          {children.map((child) => (
            <FileNode 
              key={child.path} 
              entry={child} 
              onOpenFile={onOpenFile} 
              depth={depth + 1} 
              refreshTrigger={refreshTrigger}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const FileExplorer: React.FC<FileExplorerProps> = ({ rootPath, onOpenFile, refreshTrigger }) => {
  const [rootFiles, setRootFiles] = useState<FileEntry[]>([]);

  useEffect(() => {
    if (!rootPath) return;
    invoke<FileEntry[]>("read_directory", { path: rootPath })
      .then((files) => setRootFiles(sortEntries(files)))
      .catch((e) => console.error("Failed to load root", e));
  }, [rootPath, refreshTrigger]);

  if (!rootPath) return <div className="sidebar-empty">No folder opened</div>;

  return (
    <div className="file-explorer">
      <div className="sidebar-header">EXPLORER</div>
      {rootFiles.map((file) => (
        <FileNode 
          key={file.path} 
          entry={file} 
          onOpenFile={onOpenFile} 
          depth={0} 
          refreshTrigger={refreshTrigger}
        />
      ))}
    </div>
  );
};