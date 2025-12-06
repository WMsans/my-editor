import { SidebarTab, PluginManifest, ViewContainerContribution, ViewContribution, RegisteredTopbarItem, Disposable, WebviewViewOptions } from "./types";
import { pluginEventBus } from "./events/PluginEventBus";

// The Registry is now purely a database for static contributions and UI state.
class Registry {
  // UI Elements
  private sidebarTabs: SidebarTab[] = [];
  private slashCommands: any[] = [];
  private topbarItems: RegisteredTopbarItem[] = [];
  
  // Tiptap Extensions (UI/Editor core)
  private highPriorityExtensions: any[] = [];
  private dynamicExtensions: any[] = [];

  // Static Contributions
  private viewContainers: RegisteredViewContainer[] = [];
  private views: Map<string, RegisteredView[]> = new Map();
  private webviewViews: Map<string, WebviewViewOptions> = new Map();
  
  // Change Listeners
  private listeners: (() => void)[] = [];

  init() {
    this.dynamicExtensions = [];
    this.highPriorityExtensions = []; 
    this.sidebarTabs = [];
    this.slashCommands = [];
    this.topbarItems = [];
    this.viewContainers = [];
    this.views.clear();
    this.webviewViews.clear(); 
    this.notify();
  }

  // --- Subscriptions ---
  subscribe(listener: () => void) {
      this.listeners.push(listener);
      return () => { this.listeners = this.listeners.filter(l => l !== listener); };
  }

  private notify() { this.listeners.forEach(l => l()); }

  // --- Manifest Processing ---
  registerManifest(manifest: PluginManifest) {
    if (!manifest.contributes) return;

    if (manifest.contributes.slashMenu) {
        manifest.contributes.slashMenu.forEach(cmd => {
            this.registerSlashCommand({
                id: manifest.id,
                ...cmd
            });
        });
    }

    if (manifest.contributes.viewsContainers?.activitybar) {
        manifest.contributes.viewsContainers.activitybar.forEach(vc => {
            this.viewContainers.push({ ...vc, pluginId: manifest.id });
        });
    }

    if (manifest.contributes.views) {
        for (const [containerId, viewList] of Object.entries(manifest.contributes.views)) {
            if (!this.views.has(containerId)) this.views.set(containerId, []);
            this.views.get(containerId)!.push(...viewList.map(v => ({ ...v, containerId, pluginId: manifest.id })));
        }
    }
  }

  // --- Accessors ---
  getViewContainers() { return this.viewContainers; }
  getViews(containerId: string) { return this.views.get(containerId) || []; }
  
  getPluginIdForView(viewId: string): string | undefined {
      for (const [_, views] of this.views) {
          const found = views.find(v => v.id === viewId);
          if (found) return found.pluginId;
      }
      return undefined;
  }

  // --- Editors/Extensions ---
  registerExtension(ext: any, priority: 'high' | 'normal' = 'normal') {
    if (priority === 'high') this.highPriorityExtensions.push(ext);
    else this.dynamicExtensions.push(ext);
  }
  getExtensions() { return this.dynamicExtensions; }
  getHighPriorityExtensions() { return this.highPriorityExtensions; }

  // --- Slash Commands ---
  registerSlashCommand(cmd: any) {
    if (!this.slashCommands.some(e => e.id === cmd.id && e.command === cmd.command)) {
      this.slashCommands.push(cmd);
    }
  }
  getAllSlashCommands() { return this.slashCommands; }

  // --- Sidebar Tabs (Legacy) ---
  registerSidebarTab(tab: SidebarTab) { this.sidebarTabs.push(tab); }
  getSidebarTabs() { return this.sidebarTabs; }
  
  // --- Topbar Items ---
  registerTopbarItem(item: RegisteredTopbarItem) {
      const idx = this.topbarItems.findIndex(i => i.id === item.id);
      if (idx !== -1) this.topbarItems[idx] = item;
      else this.topbarItems.push(item);
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

  // --- Webviews ---
  registerWebviewView(viewId: string, options: WebviewViewOptions) {
      this.webviewViews.set(viewId, options);
      this.notify();
  }
  getWebviewView(viewId: string) { return this.webviewViews.get(viewId); }

  // --- Events Proxy ---
  subscribeToAll(handler: (event: string, data: any) => void) {
      return pluginEventBus.subscribeToAll(handler);
  }
  emit(event: string, data?: any) {
      pluginEventBus.emit(event, data);
  }
}

export const registry = new Registry();

// Internal Interfaces
interface RegisteredViewContainer extends ViewContainerContribution { pluginId: string; }
interface RegisteredView extends ViewContribution { containerId: string; pluginId: string; }