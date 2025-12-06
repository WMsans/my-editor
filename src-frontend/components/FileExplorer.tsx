import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useProjectStore } from "../stores/useProjectStore";

interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

// Helper: Sort entries
const sortEntries = (entries: FileEntry[]) => {
  return entries.sort((a, b) => {
    if (a.is_dir === b.is_dir) return a.name.localeCompare(b.name);
    return a.is_dir ? -1 : 1;
  });
};

const FileNode: React.FC<{ 
  entry: FileEntry; 
  depth: number;
}> = ({ entry, depth }) => {
  const { setCurrentFilePath, fileSystemRefresh } = useProjectStore();
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

  useEffect(() => {
    if (expanded && entry.is_dir) {
      loadChildren();
    }
  }, [fileSystemRefresh, expanded]);

  const toggleExpand = async () => {
    if (!entry.is_dir) {
      setCurrentFilePath(entry.path);
      return;
    }
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
            <FileNode key={child.path} entry={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
};

export const FileExplorer: React.FC = () => {
  const { rootPath, fileSystemRefresh } = useProjectStore();
  const [rootFiles, setRootFiles] = useState<FileEntry[]>([]);

  useEffect(() => {
    if (!rootPath) return;
    invoke<FileEntry[]>("read_directory", { path: rootPath })
      .then((files) => setRootFiles(sortEntries(files)))
      .catch((e) => console.error("Failed to load root", e));
  }, [rootPath, fileSystemRefresh]);

  if (!rootPath) return <div className="sidebar-empty">No folder opened</div>;

  return (
    <div className="file-explorer">
      <div className="sidebar-header">EXPLORER</div>
      {rootFiles.map((file) => (
        <FileNode key={file.path} entry={file} depth={0} />
      ))}
    </div>
  );
};