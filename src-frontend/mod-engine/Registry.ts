import { Mod, Plugin, SidebarTab, HostAPI } from "./types";

class Registry {
  // Existing "Mods" (Tiptap Blocks)
  private mods: Map<string, Mod> = new Map();
  
  // New Plugin System
  private plugins: Map<string, Plugin> = new Map();
  private sidebarTabs: SidebarTab[] = [];
  
  // Initialization State
  private api: HostAPI | null = null;

  // --- Mod/Block Methods ---
  register(mod: Mod) {
    this.mods.set(mod.id, mod);
  }

  getAll(): Mod[] {
    return Array.from(this.mods.values());
  }

  getExtensions() {
    return Array.from(this.mods.values()).map(m => m.extension);
  }

  // --- Plugin Methods ---
  
  // Called by App.tsx once to provide the implementation
  init(api: HostAPI) {
    this.api = api;
    // Activate any plugins registered before init
    this.plugins.forEach(p => p.activate(api));
  }

  registerPlugin(plugin: Plugin) {
    this.plugins.set(plugin.id, plugin);
    if (this.api) {
      plugin.activate(this.api);
    }
  }

  // --- Sidebar Methods ---
  registerSidebarTab(tab: SidebarTab) {
    this.sidebarTabs.push(tab);
  }

  getSidebarTabs(): SidebarTab[] {
    return this.sidebarTabs;
  }
}

export const registry = new Registry();