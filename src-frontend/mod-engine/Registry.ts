import { Mod, SidebarTab, HostAPI, PluginManifest, ViewContainerContribution, ViewContribution, RegisteredTopbarItem, Disposable, WebviewViewOptions } from "./types";

interface SlashCommandDef {
    id: string; 
    command: string; 
    title: string;
    description: string;
}

// Internal storage wrappers
interface RegisteredViewContainer extends ViewContainerContribution {
    pluginId: string;
}
interface RegisteredView extends ViewContribution {
    containerId: string;
    pluginId: string;
}

class Registry {
  // [CHANGED] Separate high priority extensions
  private highPriorityExtensions: any[] = [];
  private dynamicExtensions: any[] = [];
  
  // UI Elements
  private sidebarTabs: SidebarTab[] = [];
  private slashCommands: SlashCommandDef[] = [];
  private topbarItems: RegisteredTopbarItem[] = [];
  
  // [PHASE 1] Static Contributions
  private viewContainers: RegisteredViewContainer[] = [];
  private views: Map<string, RegisteredView[]> = new Map();
  
  // [NEW] Webview Providers
  private webviewViews: Map<string, WebviewViewOptions> = new Map();

  // Command Handlers
  private commandHandlers = new Map<string, (args?: any) => void>();
  
  // Registry Change Listeners
  private listeners: (() => void)[] = [];

  // [PHASE 4] Application Event Bus
  private eventListeners = new Map<string, ((data: any) => void)[]>();
  private globalEventListeners: ((event: string, data: any) => void)[] = [];

  private api: HostAPI | null = null;

  init(api: HostAPI) {
    this.api = api;
    this.dynamicExtensions = [];
    this.highPriorityExtensions = []; 
    this.sidebarTabs = [];
    this.slashCommands = [];
    this.topbarItems = [];
    this.commandHandlers.clear();
    
    // Clear Static
    this.viewContainers = [];
    this.views.clear();
    this.webviewViews.clear(); 
    this.notify();

    // Clear events
    this.eventListeners.clear();
    this.globalEventListeners = [];
  }

  // --- Registry Subscription ---
  subscribe(listener: () => void) {
      this.listeners.push(listener);
      return () => {
          this.listeners = this.listeners.filter(l => l !== listener);
      };
  }

  private notify() {
      this.listeners.forEach(l => l());
  }

  // --- [PHASE 4] Event Bus Implementation ---
  
  /**
   * Listen to a specific event
   */
  on(event: string, handler: (data: any) => void): Disposable {
      if (!this.eventListeners.has(event)) {
          this.eventListeners.set(event, []);
      }
      this.eventListeners.get(event)!.push(handler);
      
      return {
          dispose: () => {
              const handlers = this.eventListeners.get(event);
              if (handlers) {
                  this.eventListeners.set(event, handlers.filter(h => h !== handler));
              }
          }
      };
  }

  /**
   * Listen to ALL events (used by WorkerBridge)
   */
  subscribeToAll(handler: (event: string, data: any) => void): Disposable {
      this.globalEventListeners.push(handler);
      return {
          dispose: () => {
              this.globalEventListeners = this.globalEventListeners.filter(h => h !== handler);
          }
      };
  }

  /**
   * Emit an event to all listeners
   */
  emit(event: string, data?: any) {
      // 1. Notify specific listeners
      const handlers = this.eventListeners.get(event);
      if (handlers) {
          handlers.forEach(h => {
              try { h(data); } catch(e) { console.error(`Error in event handler for ${event}:`, e); }
          });
      }

      // 2. Notify global listeners (e.g., Worker Bridge)
      this.globalEventListeners.forEach(h => {
          try { h(event, data); } catch(e) { console.error(`Error in global event handler for ${event}:`, e); }
      });
  }

  // --- [PHASE 1] Static Registration ---
  registerManifest(manifest: PluginManifest) {
    if (!manifest.contributes) return;

    // 1. Slash Commands (Static)
    if (manifest.contributes.slashMenu) {
        manifest.contributes.slashMenu.forEach(cmd => {
            this.registerSlashCommand({
                id: manifest.id,
                command: cmd.command,
                title: cmd.title,
                description: cmd.description
            });
        });
    }

    // 2. View Containers (Activity Bar)
    if (manifest.contributes.viewsContainers?.activitybar) {
        manifest.contributes.viewsContainers.activitybar.forEach(vc => {
            this.viewContainers.push({
                ...vc,
                pluginId: manifest.id
            });
        });
    }

    // 3. Views (Side Panels)
    if (manifest.contributes.views) {
        for (const [containerId, viewList] of Object.entries(manifest.contributes.views)) {
            if (!this.views.has(containerId)) {
                this.views.set(containerId, []);
            }
            const registeredViews = viewList.map(v => ({ 
                ...v, 
                containerId, 
                pluginId: manifest.id 
            }));
            this.views.get(containerId)!.push(...registeredViews);
        }
    }
  }

  getViewContainers() { return this.viewContainers; }
  getViews(containerId: string) { return this.views.get(containerId) || []; }

  // --- Extension Management ---
  registerExtension(ext: any, priority: 'high' | 'normal' = 'normal') {
    if (priority === 'high') {
        this.highPriorityExtensions.push(ext);
    } else {
        this.dynamicExtensions.push(ext);
    }
  }

  getExtensions() { return this.dynamicExtensions; }
  getHighPriorityExtensions() { return this.highPriorityExtensions; }

  // --- Slash Commands ---
  registerSlashCommand(cmd: SlashCommandDef) {
    const exists = this.slashCommands.some(
      (existing) => existing.id === cmd.id && existing.command === cmd.command
    );
    if (!exists) {
      this.slashCommands.push(cmd);
    }
  }
  getAllSlashCommands() { return this.slashCommands; }

  // --- Sidebar ---
  registerSidebarTab(tab: SidebarTab) { this.sidebarTabs.push(tab); }
  getSidebarTabs(): SidebarTab[] { return this.sidebarTabs; }
  
  // --- Commands ---
  registerCommand(id: string, handler: (args?: any) => void) {
    if (this.commandHandlers.has(id)) {
        console.warn(`Command "${id}" is being overwritten.`);
    }
    this.commandHandlers.set(id, handler);
  }

  executeCommand(id: string, args?: any) {
    const handler = this.commandHandlers.get(id);
    if (handler) {
      handler(args);
    } else {
      console.warn(`Command "${id}" not found.`);
    }
  }

  // --- Topbar Items ---
  registerTopbarItem(item: RegisteredTopbarItem) {
      const idx = this.topbarItems.findIndex(i => i.id === item.id);
      if (idx !== -1) {
          this.topbarItems[idx] = item;
      } else {
          this.topbarItems.push(item);
      }
      this.notify();
  }

  updateTopbarItem(id: string, options: any) {
      const item = this.topbarItems.find(i => i.id === id);
      if (item) {
          Object.assign(item, options);
          this.notify();
      }
  }

  removeTopbarItem(id: string) {
      this.topbarItems = this.topbarItems.filter(i => i.id !== id);
      this.notify();
  }

  getTopbarItems() { return this.topbarItems; }

  registerWebviewView(viewId: string, options: WebviewViewOptions) {
      this.webviewViews.set(viewId, options);
      this.notify();
  }

  getWebviewView(viewId: string) {
      return this.webviewViews.get(viewId);
  }
}

export const registry = new Registry();