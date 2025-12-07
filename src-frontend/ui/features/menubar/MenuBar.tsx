import React, { useState, useEffect } from "react";
import { RegisteredTopbarItem } from "../../../engine/types";
import { useProjectStore } from "../../../core/stores/useProjectStore";
import { useUIStore } from "../../../core/stores/useUIStore";
import { useTopbar } from "../../hooks/useTopbar";
import styles from "./MenuBar.module.css"; 

interface MenuBarProps {
  onNew: () => void;
  onOpenFolder: () => void;
  onSave: () => void;
  onQuit: () => void;
}

export const MenuBar: React.FC<MenuBarProps> = ({ 
  onNew, onOpenFolder, onSave, onQuit 
}) => {
  const { currentFilePath } = useProjectStore();
  const { setShowSettings } = useUIStore();
  const { items: extraItems } = useTopbar();
  const [activeMenu, setActiveMenu] = useState<string | null>(null);

  useEffect(() => {
    const close = () => setActiveMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  const renderItem = (item: RegisteredTopbarItem) => {
    // Dynamic width must remain inline, but everything else moves to CSS
    const widthStyle = item.width ? { width: item.width } : {};

    if (item.type === 'button') {
        return (
            <button 
                key={item.id} 
                className={styles.toolbarItem}
                style={widthStyle}
                onClick={(e) => { e.stopPropagation(); if (!item.disabled) item.onClick?.(); }} 
                disabled={item.disabled} 
                title={item.tooltip}
            >
                {item.icon && <span style={{marginRight: item.label ? '5px':0}}>{item.icon}</span>}
                {item.label}
            </button>
        );
    } 
    
    if (item.type === 'text') {
        return (
            <div key={item.id} className={styles.toolbarInputContainer}>
                {item.label && <span className={styles.toolbarLabel}>{item.label}</span>}
                <input 
                    type="text" 
                    className={`${styles.toolbarItem} ${styles.toolbarInput}`}
                    style={widthStyle}
                    placeholder={item.placeholder} 
                    defaultValue={item.value} 
                    onChange={(e) => item.onChange?.(e.target.value)} 
                    onClick={(e) => e.stopPropagation()} 
                    disabled={item.disabled} 
                />
            </div>
        );
    }

    if (item.type === 'dropdown') {
        return (
            <div key={item.id} className={styles.toolbarInputContainer}>
                 {item.label && <span className={styles.toolbarLabel}>{item.label}</span>}
                 <select 
                    className={styles.toolbarItem}
                    style={widthStyle}
                    defaultValue={item.value} 
                    onChange={(e) => item.onChange?.(e.target.value)} 
                    onClick={(e) => e.stopPropagation()} 
                    disabled={item.disabled}
                 >
                     {item.options?.map(opt => ( <option key={opt} value={opt}>{opt}</option> ))}
                 </select>
            </div>
        )
    }
    return null;
  };

  return (
    <div className={styles.topBar} onClick={(e) => e.stopPropagation()}>
      <div className={styles.menuItem}>
        <span onClick={() => setActiveMenu(activeMenu === "file" ? null : "file")}>File</span>
        {activeMenu === "file" && (
          <div className={styles.dropdown}>
            <div className={styles.dropdownItem} onClick={() => { onNew(); setActiveMenu(null); }}>New File</div>
            <div className={styles.separator} />
            <div className={styles.dropdownItem} onClick={() => { onOpenFolder(); setActiveMenu(null); }}>Open Folder...</div>
            <div className={styles.separator} />
            <div className={styles.dropdownItem} onClick={() => { onSave(); setActiveMenu(null); }}>Save</div>
            <div className={styles.separator} />
            <div className={styles.dropdownItem} onClick={() => { setShowSettings(true); setActiveMenu(null); }}>Settings</div>
            <div className={styles.separator} />
            <div className={styles.dropdownItem} onClick={() => { onQuit(); setActiveMenu(null); }}>Quit</div>
          </div>
        )}
      </div>
      
      <div className={styles.pluginToolbar}>
          {extraItems.map(item => renderItem(item))}
      </div>

      <div className={styles.currentFileLabel}>
        {currentFilePath ? `Editing: ${currentFilePath}` : "Untitled (Unsaved)"}
      </div>
    </div>
  );
};