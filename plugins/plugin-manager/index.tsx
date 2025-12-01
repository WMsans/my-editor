import React, { useEffect, useState } from "react";

const PluginManagerTab = (props: any) => {
  const [plugins, setPlugins] = useState<any[]>([]);
  const [needsReload, setNeedsReload] = useState(false);

  // The 'props' passed to sidebar components are currently empty,
  // but we can access the API via the global `window.CollabAPI` or 
  // we can rely on the fact that this code runs in the main thread context
  // where it can import the 'activate' context if we stored it. 
  // However, simpler is to access the global we exposed in App.tsx for now
  // or use the context closure if we had passed it.
  
  // Since sidebar tabs are React Components rendered by the Sidebar, 
  // they don't automatically get the 'context' prop unless we change Sidebar.tsx.
  // BUT, we can access the global HostAPI because we are in the same JS bundle (in 'main' mode).
  
  const api = (window as any).CollabAPI; 

  useEffect(() => {
    loadPlugins();
  }, []);

  const loadPlugins = async () => {
    if (!api) return;
    const list = await api.plugins.getAll();
    const mapped = list.map((p: any) => ({
        ...p,
        enabled: api.plugins.isEnabled(p.id)
    }));
    setPlugins(mapped);
  };

  const togglePlugin = (id: string, currentStatus: boolean) => {
    if (!api) return;
    api.plugins.setEnabled(id, !currentStatus);
    setNeedsReload(true);
    // Optimistic update
    setPlugins(prev => prev.map(p => 
        p.id === id ? { ...p, enabled: !currentStatus } : p
    ));
  };

  const handleReload = () => {
    window.location.reload();
  };

  return (
    <div style={{ padding: '10px', color: '#cdd6f4' }}>
      <h3 style={{ borderBottom: '1px solid #313244', paddingBottom: '10px' }}>Extensions</h3>
      
      {needsReload && (
        <div style={{ 
            background: '#fab387', color: '#1e1e2e', padding: '8px', 
            marginBottom: '10px', borderRadius: '4px', fontSize: '0.8rem',
            display: 'flex', flexDirection: 'column', gap: '5px'
        }}>
           <span>Changes require reload.</span>
           <button onClick={handleReload} style={{ cursor: 'pointer', padding: '4px', border: 'none', background: '#1e1e2e', color: 'white', borderRadius: '3px'}}>Reload Now</button>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {plugins.map(p => (
            <div key={p.id} style={{ 
                background: '#181825', border: '1px solid #313244', 
                borderRadius: '6px', padding: '10px'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
                    <strong style={{ fontSize: '0.9rem' }}>{p.name}</strong>
                    <input 
                        type="checkbox" 
                        checked={p.enabled} 
                        onChange={() => togglePlugin(p.id, p.enabled)}
                        style={{ cursor: 'pointer' }}
                        disabled={p.id === 'plugin-manager'} // Prevent disabling itself easily
                    />
                </div>
                <div style={{ fontSize: '0.75rem', color: '#a6adc8', marginBottom: '5px' }}>{p.description}</div>
                <div style={{ fontSize: '0.7rem', color: '#585b70' }}>v{p.version} • {p.author}</div>
            </div>
        ))}
      </div>
    </div>
  );
};

export function activate(context: any) {
  context.ui.registerSidebarTab({
    id: "plugin-manager",
    icon: "🧩",
    label: "Plugins",
    component: PluginManagerTab
  });
}

export function deactivate() {}