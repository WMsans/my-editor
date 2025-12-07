import { Disposable } from "../types";

export class CommandService {
  private handlers = new Map<string, (args?: any) => any>();

  /**
   * Register a command handler.
   */
  registerCommand(id: string, handler: (args?: any) => any): Disposable {
    if (this.handlers.has(id)) {
      console.warn(`[CommandService] Overwriting handler for command: ${id}`);
    }
    this.handlers.set(id, handler);
    return {
      dispose: () => this.handlers.delete(id)
    };
  }

  /**
   * Execute a command by ID.
   */
  executeCommand(id: string, args?: any): any {
    const handler = this.handlers.get(id);
    if (!handler) {
        console.warn(`[CommandService] Command not found: ${id}`);
        return undefined;
    }
    try {
        return handler(args);
    } catch (error) {
        console.error(`[CommandService] Error executing ${id}:`, error);
        throw error;
    }
  }

  /**
   * Check if a command is registered.
   */
  hasCommand(id: string): boolean {
    return this.handlers.has(id);
  }
}

export const commandService = new CommandService();