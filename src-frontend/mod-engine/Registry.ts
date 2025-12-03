import { Mod, SidebarTab, HostAPI, PluginManifest, ViewContainerContribution, ViewContribution, RegisteredTopbarItem, Disposable, WebviewPanel } from "./types";
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
  private highPriorityExtensions: any[] = [];
  private dynamicExtensions: any[] = [];
  
  // UI Elements
  private sidebarTabs: SidebarTab[] = [];
  private slashCommands: SlashCommandDef[] = [];
  private topbarItems: RegisteredTopbarItem[] = [];
  
  // [PHASE 1] Static Contributions
  private viewContainers: RegisteredViewContainer[] = [];
  private views: Map<string, RegisteredView[]> = new Map();

  // Command Handlers
  private commandHandlers = new Map<string, (args?: any) => void>();
  
  // Registry Change Listeners
  private listeners: (() => void)[] = [];

  // [PHASE 4] Application Event Bus
  private eventListeners = new Map<string, ((data: any) => void)[]>();
  private globalEventListeners: ((event: string, data: any) => void)[] = [];

  private activeWebviews: Map<string, { id: string, title: string, html: string, visible: boolean }> = new Map();

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
    this.notify();

    // Clear events
    this.eventListeners.clear();
    this.globalEventListeners = [];

    // Clear Webview
    this.activeWebviews.clear();
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

  registerWebviewPanel(id: string, title: string, html: string = "") {
      this.activeWebviews.set(id, { id, title, html, visible: true });
      // Note: We do NOT auto-hide others here because multiple blocks can be active.
      // This is a change from single-panel logic.
      this.notify();
      this.emit('webview:created', { id });
  }

  updateWebviewHtml(id: string, html: string) {
      const wv = this.activeWebviews.get(id);
      if (wv) {
          wv.html = html;
          this.notify(); // Triggers React re-render
      }
  }

  getWebview(id: string) {
      return this.activeWebviews.get(id);
  }

  getActiveWebview() {
      // Deprecated for blocks, used for EditorArea's main webview
      for (const wv of this.activeWebviews.values()) {
          // A hack to distinguish main panel from blocks: Main panels probably have generic IDs or are singletons in Phase 5
          // For now, return the first one. 
          if (wv.visible) return wv;
      }
      return null;
  }

  disposeWebview(id: string) {
      this.activeWebviews.delete(id);
      this.notify();
      this.emit('webview:disposed', { id });
  }

  // [NEW] Helper to trigger resolution in Worker
  resolveWebviewBlock(viewType: string, webviewId: string) {
      this.emit('webview:block:resolve', { viewType, webviewId });
  }
}

export const registry = new Registry();