import React, { useState } from "react";

interface MenuBarProps {
  onNew: () => void;
  onOpenFolder: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  currentFile: string | null;
}

export const MenuBar: React.FC<MenuBarProps> = ({ onNew, onOpenFolder, onSave, onSaveAs, currentFile }) => {
  const [activeMenu, setActiveMenu] = useState<string | null>(null);

  const toggleMenu = (menu: string) => {
    setActiveMenu(activeMenu === menu ? null : menu);
  };

  // Close dropdown when clicking elsewhere (simple implementation)
  React.useEffect(() => {
    const close = () => setActiveMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  return (
    <div className="top-bar" onClick={(e) => e.stopPropagation()}>
      <div className="menu-item">
        <span onClick={() => toggleMenu("file")}>File</span>
        {activeMenu === "file" && (
          <div className="dropdown">
            <div onClick={() => { onNew(); setActiveMenu(null); }}>New File</div>
            <div className="separator" />
            <div onClick={() => { onOpenFolder(); setActiveMenu(null); }}>Open Folder...</div>
            <div className="separator" />
            <div onClick={() => { onSave(); setActiveMenu(null); }}>Save</div>
            <div onClick={() => { onSaveAs(); setActiveMenu(null); }}>Save As...</div>
          </div>
        )}
      </div>
      <div className="current-file-label">
        {currentFile ? `Editing: ${currentFile}` : "Untitled"}
      </div>
    </div>
  );
};