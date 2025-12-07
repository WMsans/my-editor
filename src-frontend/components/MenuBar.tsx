import React, { useState, useEffect } from "react";
import { RegisteredTopbarItem } from "../mod-engine/types";
import { useProjectStore } from "../stores/useProjectStore";
import { useUIStore } from "../stores/useUIStore";
import { useTopbar } from "../hooks/useTopbar";
import styles from "./MenuBar.module.css"; 

interface MenuBarProps {
  onNew: () => void;
  onOpenFolder: () => void;
  onSave: () => void;
  onQuit: () => void;
}

export const MenuBar: React.FC<MenuBarProps> = ({ 
  onNew, 
  onOpenFolder, 
  onSave, 
  onQuit 
}) => {
  const { currentFilePath } = useProjectStore();
  const { setShowSettings } = useUIStore();
  
  // Use Custom Hook for Logic
  const { items: extraItems } = useTopbar();

  const [activeMenu, setActiveMenu] = useState<string | null>(null);

  const toggleMenu = (menu: string) => {
    setActiveMenu(activeMenu === menu ? null : menu);
  };

  useEffect(() => {
    const close = () => setActiveMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  const renderItem = (item: RegisteredTopbarItem) => {
    const style: React.CSSProperties = { 
        marginLeft: '10px', fontSize: '0.8rem', padding: '4px 8px',
        background: item.disabled ? '#252635' : '#313244',
        border: '1px solid #45475a', color: item.disabled ? '#585b70' : '#cdd6f4',
        borderRadius: '4px', cursor: item.disabled ? 'default' : 'pointer',
        width: item.width || 'auto', opacity: item.disabled ? 0.6 : 1,
        pointerEvents: item.disabled ? 'none' : 'auto'
    };

    if (item.type === 'button') {
        return (
            <button key={item.id} style={style} onClick={(e) => { e.stopPropagation(); if (!item.disabled) item.onClick?.(); }} disabled={item.disabled} title={item.tooltip}>
                {item.icon && <span style={{marginRight: item.label ? '5px':0}}>{item.icon}</span>}
                {item.label}
            </button>
        );
    } 
    
    if (item.type === 'text') {
        return (
            <div key={item.id} style={{ display: 'flex', alignItems: 'center', marginLeft: '10px' }}>
                {item.label && <span style={{marginRight: '5px', fontSize: '0.8rem', color:'#a6adc8'}}>{item.label}</span>}
                <input type="text" placeholder={item.placeholder} defaultValue={item.value} style={{ ...style, cursor: 'text', background: '#11111b' }} onChange={(e) => item.onChange?.(e.target.value)} onClick={(e) => e.stopPropagation()} disabled={item.disabled} />
            </div>
        );
    }

    if (item.type === 'dropdown') {
        return (
            <div key={item.id} style={{ display: 'flex', alignItems: 'center', marginLeft: '10px' }}>
                 {item.label && <span style={{marginRight: '5px', fontSize: '0.8rem', color:'#a6adc8'}}>{item.label}</span>}
                 <select style={style} defaultValue={item.value} onChange={(e) => item.onChange?.(e.target.value)} onClick={(e) => e.stopPropagation()} disabled={item.disabled}>
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
        <span onClick={() => toggleMenu("file")}>File</span>
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