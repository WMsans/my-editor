import { FileSystemService } from "./FileSystemService";
import { AuthService } from "./AuthService";
import { P2PService } from "./P2PService";
import { WorkspaceManager } from "./WorkspaceManager"; 

export const fsService = new FileSystemService();
export const authService = new AuthService();
export const p2pService = new P2PService();
export const workspaceManager = new WorkspaceManager();

// Dependency Injection Wiring
// This breaks the circular dependency between P2PService and WorkspaceManager
p2pService.injectWorkspaceManager(workspaceManager);

// Initialize Services
p2pService.init();

// Export the singleton instance explicitly for consumers
export { WorkspaceManager };