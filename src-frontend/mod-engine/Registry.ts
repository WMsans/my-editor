import { Mod, SidebarTab, HostAPI } from "./types";

interface SlashCommandDef {
    id: string; 
    command: string; 
    title: string;
    description: string;
}

class Registry {
  // Tiptap Extensions
  private dynamicExtensions: any[] = [];
  
  // UI Elements
  private sidebarTabs: SidebarTab[] = [];
  private slashCommands: SlashCommandDef[] = [];
  
  // Command Handlers
  private commandHandlers = new Map<string, (args?: any) => void>();
  
  private api: HostAPI | null = null;

  init(api: HostAPI) {
    this.api = api;
    // [FIX] Clear existing registries to prevent duplicates on re-initialization
    this.dynamicExtensions = [];
    this.sidebarTabs = [];
    this.slashCommands = [];
    this.commandHandlers.clear();
  }

  // --- Extension Management ---
  registerExtension(ext: any) {
    this.dynamicExtensions.push(ext);
  }

  getExtensions() {
    return this.dynamicExtensions;
  }

  // --- Slash Menu Management ---
  registerSlashCommand(cmd: SlashCommandDef) {
    this.slashCommands.push(cmd);
  }

  getAllSlashCommands() {
    return this.slashCommands;
  }

  // --- Sidebar Management ---
  registerSidebarTab(tab: SidebarTab) {
    this.sidebarTabs.push(tab);
  }

  getSidebarTabs(): SidebarTab[] {
    return this.sidebarTabs;
  }

  // --- Command Registry Implementation ---
  registerCommand(id: string, handler: (args?: any) => void) {
    if (this.commandHandlers.has(id)) {
        console.warn(`Command "${id}" is being overwritten.`);
    }
    this.commandHandlers.set(id, handler);
    console.log(`Command registered: ${id}`);
  }

  executeCommand(id: string, args?: any) {
    const handler = this.commandHandlers.get(id);
    if (handler) {
      handler(args);
    } else {
      console.warn(`Command "${id}" not found.`);
    }
  }
}

export const registry = new Registry();