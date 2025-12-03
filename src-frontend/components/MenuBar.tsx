import React, { useState, useEffect } from "react";
import { registry } from "../mod-engine/Registry";
import { RegisteredTopbarItem } from "../mod-engine/types";

interface MenuBarProps {
  onNew: () => void;
  onOpenFolder: () => void;
  onSettings: () => void;
  onQuit: () => void;
  onSave: () => void;
  currentFile: string | null;
}

export const MenuBar: React.FC<MenuBarProps> = ({ 
  onNew, 
  onOpenFolder, 
  onSettings,
  onQuit,
  onSave,
  currentFile 
}) => {
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [extraItems, setExtraItems] = useState<RegisteredTopbarItem[]>([]);

  const toggleMenu = (menu: string) => {
    setActiveMenu(activeMenu === menu ? null : menu);
  };

  useEffect(() => {
    // Initial Load
    setExtraItems([...registry.getTopbarItems()]);

    // Subscribe to changes
    const unsubscribe = registry.subscribe(() => {
        setExtraItems([...registry.getTopbarItems()]);
    });

    const close = () => setActiveMenu(null);
    window.addEventListener("click", close);
    return () => {
        window.removeEventListener("click", close);
        unsubscribe();
    };
  }, []);

  // Helper to render dynamic items
  const renderItem = (item: RegisteredTopbarItem) => {
    const style: React.CSSProperties = { 
        marginLeft: '10px', 
        fontSize: '0.8rem',
        padding: '4px 8px',
        background: item.disabled ? '#252635' : '#313244',
        border: '1px solid #45475a',
        color: item.disabled ? '#585b70' : '#cdd6f4',
        borderRadius: '4px',
        cursor: item.disabled ? 'default' : 'pointer',
        width: item.width || 'auto',
        opacity: item.disabled ? 0.6 : 1,
        pointerEvents: item.disabled ? 'none' : 'auto'
    };

    if (item.type === 'button') {
        return (
            <button 
                key={item.id} 
                style={style}
                onClick={(e) => { 
                    e.stopPropagation(); 
                    if (!item.disabled) item.onClick?.(); 
                }}
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
            <div key={item.id} style={{ display: 'flex', alignItems: 'center', marginLeft: '10px' }}>
                {item.label && <span style={{marginRight: '5px', fontSize: '0.8rem', color:'#a6adc8'}}>{item.label}</span>}
                <input 
                    type="text" 
                    placeholder={item.placeholder}
                    defaultValue={item.value}
                    style={{ ...style, cursor: 'text', background: '#11111b' }}
                    onChange={(e) => item.onChange?.(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    disabled={item.disabled}
                />
            </div>
        );
    }

    if (item.type === 'dropdown') {
        return (
            <div key={item.id} style={{ display: 'flex', alignItems: 'center', marginLeft: '10px' }}>
                 {item.label && <span style={{marginRight: '5px', fontSize: '0.8rem', color:'#a6adc8'}}>{item.label}</span>}
                 <select 
                    style={style}
                    defaultValue={item.value}
                    onChange={(e) => item.onChange?.(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    disabled={item.disabled}
                 >
                     {item.options?.map(opt => (
                         <option key={opt} value={opt}>{opt}</option>
                     ))}
                 </select>
            </div>
        )
    }

    return null;
  };

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
            <div className="separator" />
            <div onClick={() => { onSettings(); setActiveMenu(null); }}>Settings</div>
            <div className="separator" />
            <div onClick={() => { onQuit(); setActiveMenu(null); }}>Quit</div>
          </div>
        )}
      </div>
      
      {/* Plugin Items Area */}
      <div className="plugin-toolbar" style={{ display: 'flex', alignItems: 'center', borderLeft: '1px solid #313244', paddingLeft: '10px', height: '100%' }}>
          {extraItems.map(item => renderItem(item))}
      </div>

      <div className="current-file-label">
        {currentFile ? `Editing: ${currentFile}` : "Untitled (Unsaved)"}
      </div>
    </div>
  );
};