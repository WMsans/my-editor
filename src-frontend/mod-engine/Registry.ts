import { Mod, SidebarTab, HostAPI } from "./types";

interface SlashCommandDef {
    id: string; 
    command: string; 
    title: string;
    description: string;
}

class Registry {
  // [CHANGED] Separate high priority extensions
  private highPriorityExtensions: any[] = [];
  private dynamicExtensions: any[] = [];
  
  // UI Elements
  private sidebarTabs: SidebarTab[] = [];
  private slashCommands: SlashCommandDef[] = [];
  
  // Command Handlers
  private commandHandlers = new Map<string, (args?: any) => void>();
  
  private api: HostAPI | null = null;

  init(api: HostAPI) {
    this.api = api;
    this.dynamicExtensions = [];
    this.highPriorityExtensions = []; // Clear high priority
    this.sidebarTabs = [];
    this.slashCommands = [];
    this.commandHandlers.clear();
  }

  // --- Extension Management ---
  // [CHANGED] Accept priority
  registerExtension(ext: any, priority: 'high' | 'normal' = 'normal') {
    if (priority === 'high') {
        this.highPriorityExtensions.push(ext);
    } else {
        this.dynamicExtensions.push(ext);
    }
  }

  getExtensions() {
    return this.dynamicExtensions;
  }

  // [NEW]
  getHighPriorityExtensions() {
    return this.highPriorityExtensions;
  }

  // ... (keep rest of file: registerSlashCommand, etc.)
  registerSlashCommand(cmd: SlashCommandDef) {
    const exists = this.slashCommands.some(
      (existing) => existing.id === cmd.id && existing.command === cmd.command
    );
    if (!exists) {
      this.slashCommands.push(cmd);
    }
  }

  getAllSlashCommands() { return this.slashCommands; }
  registerSidebarTab(tab: SidebarTab) { this.sidebarTabs.push(tab); }
  getSidebarTabs(): SidebarTab[] { return this.sidebarTabs; }
  
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