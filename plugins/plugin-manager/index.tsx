import { HostAPI } from "../../src-frontend/mod-engine/types";

export function activate(context: HostAPI) {
  const api = context;
  const VIEW_ID = "plugin-list";

  // 1. Register the Webview
  // We point to 'webview.html' which will be served via plugin://plugin-manager/webview.html
  api.window.registerWebviewView(VIEW_ID, {
      entryPoint: "webview.html"
  });

  // 2. Helper to fetch and broadcast plugin list
  const broadcastPlugins = async () => {
      const plugins = await api.plugins.getAll();
      const pluginData = plugins.map((p: any) => ({
          ...p,
          enabled: api.plugins.isEnabled(p.id)
      }));

      // Emit event that the webview (via host bridge) can listen to
      api.events.emit("plugin-manager:data", pluginData);
  };

  // 3. Handle Commands from UI
  // The webview will send messages that trigger these commands via the host
  api.commands.registerCommand("plugin-manager.refresh", () => {
      broadcastPlugins();
  });

  api.commands.registerCommand("plugin-manager.toggle", async (args: any) => {
      const { id, enabled } = args;
      // Toggle state
      api.plugins.setEnabled(id, !enabled);
      
      // Notify user
      api.ui.showNotification(`Plugin '${id}' ${!enabled ? 'enabled' : 'disabled'}. Reload required.`);
      
      // Refresh list to update UI
      broadcastPlugins();
  });

  // 4. Initial Broadcast (Wait a moment for the view to load)
  setTimeout(broadcastPlugins, 1000);
  
  // Listen for generic updates
  api.events.on("plugin-registry:updated", () => broadcastPlugins());
}

export function deactivate() {}