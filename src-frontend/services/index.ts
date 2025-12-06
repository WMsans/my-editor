import { FileSystemService } from "./FileSystemService";
import { AuthService } from "./AuthService";
import { P2PService } from "./P2PService";

export const fsService = new FileSystemService();
export const authService = new AuthService();
export const p2pService = new P2PService();

// Initialize early
p2pService.init();