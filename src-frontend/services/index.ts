import { FileSystemService } from "./FileSystemService";
import { AuthService } from "./AuthService";
import { P2PService } from "./P2PService";
import { CollabService } from "./CollabService";
import { SessionService } from "./SessionService";
import { WorkspaceManager } from "./WorkspaceManager"; 

// 1. Core Infrastructure
export const fsService = new FileSystemService();
export const authService = new AuthService();
export const p2pService = new P2PService();

// 2. Business Logic Layers
export const collabService = new CollabService(p2pService);
export const sessionService = new SessionService(p2pService, authService, fsService, collabService);

// 3. Application Mediator
export const workspaceManager = new WorkspaceManager(fsService, collabService);

// Initialize Transport
p2pService.init();

export { WorkspaceManager, P2PService, CollabService, SessionService };