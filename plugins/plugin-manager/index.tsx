export function activate(context: any) {
  const api = context;

  // 1. Register Toggle Command
  // This command is triggered when clicking the Status item in the tree.
  api.commands.registerCommand("plugin-manager.toggle", (args: any[]) => {
      const params = args[0];
      if (!params) return;
      
      const { id, enabled } = params;
      const newState = !enabled;
      
      // Update configuration
      api.plugins.setEnabled(id, newState);
      
      // Notify user (Refresh is not yet supported by the engine, so reload is needed)
      api.ui.showNotification(`Plugin '${id}' ${newState ? 'enabled' : 'disabled'}. Reload window to apply changes.`);
  });

  // 2. Define Data Provider
  // This supplies the data for the new "Installed Plugins" view.
  const treeDataProvider = {
      getChildren: async (element: any) => {
          if (!element) {
              // Root: List all installed plugins
              const plugins = await api.plugins.getAll();
              
              return plugins.map((p: any) => ({
                  type: 'plugin',
                  manifest: p,
                  enabled: api.plugins.isEnabled(p.id)
              }));
          }
          
          if (element.type === 'plugin') {
              // Children: Details and Actions for a specific plugin
              return [
                  { type: 'detail', label: `Version: ${element.manifest.version}` },
                  { type: 'detail', label: `Author: ${element.manifest.author}` },
                  { type: 'detail', label: element.manifest.description || "No description" },
                  { 
                      type: 'action', 
                      label: element.enabled ? "Status: Enabled (Click to Disable)" : "Status: Disabled (Click to Enable)",
                      pluginId: element.manifest.id,
                      enabled: element.enabled
                  }
              ];
          }
          return [];
      },
      
      getTreeItem: (element: any) => {
          if (element.type === 'plugin') {
              return {
                  label: element.manifest.name,
                  description: element.manifest.version,
                  collapsibleState: 'collapsed',
                  icon: element.enabled ? '🧩' : '⚪',
              };
          }
          
          if (element.type === 'detail') {
              return {
                  label: element.label,
                  collapsibleState: 'none',
                  icon: '🔹'
              };
          }
          
          if (element.type === 'action') {
              return {
                  label: element.label,
                  collapsibleState: 'none',
                  icon: element.enabled ? '✅' : '❌',
                  command: {
                      command: 'plugin-manager.toggle',
                      title: 'Toggle Plugin',
                      arguments: [{ id: element.pluginId, enabled: element.enabled }]
                  }
              };
          }
          return {};
      }
  };

  // 3. Register the Tree View
  // The ID "plugin-list" matches the "views" entry in plugin.json
  api.window.createTreeView("plugin-list", { treeDataProvider });
}

export function deactivate() {}