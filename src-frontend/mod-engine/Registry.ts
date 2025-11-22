// src-frontend/mod-engine/Registry.ts
import { Mod } from "./types";

class ModRegistry {
  private mods: Map<string, Mod> = new Map();

  register(mod: Mod) {
    this.mods.set(mod.id, mod);
  }

  getAll(): Mod[] {
    return Array.from(this.mods.values());
  }

  getExtensions() {
    return Array.from(this.mods.values()).map(m => m.extension);
  }
}

export const registry = new ModRegistry();