import { invoke } from "@tauri-apps/api/core";
import { HostAPI, PluginManifest, ActivePlugin } from "./types";
import { registry } from "./Registry";

// --- Host Dependencies for Injection ---
// Plugins import these, but we provide the host instances to ensure singletons.
import * as React from "react";
import * as ReactDOM from "react-dom";
import * as TiptapReact from "@tiptap/react";
import * as TiptapCore from "@tiptap/core";

// Define the shape of a File Entry from Tauri
interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

class PluginLoaderService {
  private activePlugins: Map<string, ActivePlugin> = new Map();
  private loadedExtensions: any[] = [];

  /**
   * 1. Discovery Phase
   * Scans the 'plugins' directory for folders containing plugin.json
   */
  async discoverPlugins(pluginsRootPath: string): Promise<PluginManifest[]> {
    try {
      // 1. Get list of folders in ./plugins
      const entries = await invoke<FileEntry[]>("read_directory", { path: pluginsRootPath });
      const manifests: PluginManifest[] = [];

      for (const entry of entries) {
        if (entry.is_dir) {
          // 2. Try to read plugin.json
          const sep = entry.path.includes("\\") ? "\\" : "/";
          const configPath = `${entry.path}${sep}plugin.json`;
          
          try {
            const configBytes = await invoke<number[]>("read_file_content", { path: configPath });
            const configStr = new TextDecoder().decode(new Uint8Array(configBytes));
            const manifest: PluginManifest = JSON.parse(configStr);
            
            // Attach the absolute path for later loading
            (manifest as any)._rootPath = entry.path; 
            manifests.push(manifest);
          } catch (e) {
            console.warn(`Skipping invalid plugin folder: ${entry.name}`, e);
          }
        }
      }
      return manifests;
    } catch (e) {
      console.error("Failed to scan plugins directory:", e);
      return [];
    }
  }

  /**
   * 2. Loading Phase
   * Reads the JS code, creates a sandbox, and executes 'activate'
   */
  async loadPlugins(api: HostAPI, manifests: PluginManifest[]) {
    for (const manifest of manifests) {
      await this.loadSinglePlugin(api, manifest);
    }
  }

  private async loadSinglePlugin(api: HostAPI, manifest: PluginManifest) {
    try {
      const root = (manifest as any)._rootPath;
      const sep = root.includes("\\") ? "\\" : "/";
      const mainPath = `${root}${sep}${manifest.main}`;

      // 1. Read Code
      const codeBytes = await invoke<number[]>("read_file_content", { path: mainPath });
      let code = new TextDecoder().decode(new Uint8Array(codeBytes));

      // 2. Dependency Injection (Poor man's module system)
      // In a real production app, you would compile plugins to UMD or SystemJS.
      // Here, we provide a synthetic 'require' and 'exports'.
      const exports: any = {};
      const module = { exports };
      
      const syntheticRequire = (modName: string) => {
        switch (modName) {
          case "react": return React;
          case "react-dom": return ReactDOM;
          case "@tiptap/react": return TiptapReact;
          case "@tiptap/core": return TiptapCore;
          default: throw new Error(`Plugin ${manifest.id} requested unknown module ${modName}`);
        }
      };

      // 3. Execution Wrapper
      // We wrap the code in a function to inject our globals.
      // NOTE: This assumes the plugin code is transpiled to JS (CommonJS or similar)
      // If it contains "import ... from", this eval will fail unless we strip them.
      
      // For this demo, let's assume standard Function constructor wrapping:
      const runPlugin = new Function("exports", "require", "module", "React", code);
      
      runPlugin(exports, syntheticRequire, module, React);

      // 4. Lifecycle: Activate
      if (exports.activate && typeof exports.activate === 'function') {
        exports.activate(api);
        
        // Register slash commands if present in manifest
        if (manifest.contributes?.slashMenu) {
            manifest.contributes.slashMenu.forEach(item => {
                registry.registerSlashCommand({
                    id: manifest.id,
                    command: item.command,
                    title: item.title,
                    description: item.description
                });
            });
        }

        this.activePlugins.set(manifest.id, {
          manifest,
          instance: exports,
        });
        console.log(`✅ Plugin Activated: ${manifest.name}`);
      }

    } catch (e) {
      console.error(`Failed to load plugin ${manifest.id}:`, e);
    }
  }

  /**
   * 3. Cleanup
   */
  deactivateAll() {
    this.activePlugins.forEach(p => {
      if (p.instance.deactivate) {
        try { p.instance.deactivate(); } catch(e) { console.error(e); }
      }
    });
    this.activePlugins.clear();
  }
}

export const pluginLoader = new PluginLoaderService();