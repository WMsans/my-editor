import { invoke } from "@tauri-apps/api/core";
import { HostAPI, PluginManifest, ActivePlugin } from "./types";
import { registry } from "./Registry";
import { transform } from "sucrase"; 
import { WorkerClient } from "./worker/WorkerClient";
import { createScopedAPI } from "./HostAPIImpl";

import * as React from "react";
import * as ReactDOM from "react-dom";
import * as TiptapReact from "@tiptap/react";
import * as TiptapCore from "@tiptap/core";
import * as PMState from "@tiptap/pm/state";

interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

class PluginLoaderService {
  private activePlugins: Map<string, ActivePlugin> = new Map();
  private workerClient: WorkerClient | null = null;

  async discoverPlugins(pluginsRootPath: string): Promise<PluginManifest[]> {
    try {
      const entries = await invoke<FileEntry[]>("read_directory", { path: pluginsRootPath });
      const manifests: PluginManifest[] = [];

      for (const entry of entries) {
        if (entry.is_dir) {
          const sep = entry.path.includes("\\") ? "\\" : "/";
          const configPath = `${entry.path}${sep}plugin.json`;
          
          try {
            const configBytes = await invoke<number[]>("read_file_content", { path: configPath });
            const configStr = new TextDecoder().decode(new Uint8Array(configBytes));
            const manifest: PluginManifest = JSON.parse(configStr);
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

  async loadPlugins(api: HostAPI, manifests: PluginManifest[]) {
    // Initialize Worker Client if needed
    if (!this.workerClient) {
        this.workerClient = new WorkerClient(api);
    }

    for (const manifest of manifests) {
      await this.loadSinglePlugin(api, manifest);
    }
  }

  private async loadSinglePlugin(api: HostAPI, manifest: PluginManifest) {
    try {
      const root = (manifest as any)._rootPath;
      const sep = root.includes("\\") ? "\\" : "/";
      const mainPath = `${root}${sep}${manifest.main}`;

      const codeBytes = await invoke<number[]>("read_file_content", { path: mainPath });
      const rawCode = new TextDecoder().decode(new Uint8Array(codeBytes));

      let code = rawCode;
      try {
        const compiled = transform(rawCode, {
          transforms: ["typescript", "jsx", "imports"],
          filePath: mainPath,
          production: true, 
        });
        code = compiled.code;
      } catch (err) {
        console.error(`Transpilation failed for ${manifest.id}:`, err);
        return; 
      }

      if (manifest.executionEnvironment === 'worker') {
         // --- WORKER MODE ---
         console.log(`🚀 Loading ${manifest.name} in Worker...`);
         
         // In worker mode, we don't pass the main API. The worker client handles bridging.
         this.workerClient?.loadPlugin(manifest.id, code, manifest);
         
         // Register Slash Commands (Manifest only)
         // The Worker will register the handler via RPC "REGISTER_COMMAND_PROXY"
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
             instance: { /* Placeholder for worker plugin */ }
         });
      }
      else{
        const exports: any = {};
        const module = { exports };
        
        const syntheticRequire = (modName: string) => {
          switch (modName) {
            case "react": return React;
            case "react-dom": return ReactDOM;
            case "@tiptap/react": return TiptapReact;
            case "@tiptap/core": return TiptapCore;
            case "@tiptap/pm/state": return PMState;
            default: throw new Error(`Plugin ${manifest.id} requested unknown module ${modName}`);
          }
        };

        const runPlugin = new Function("exports", "require", "module", "React", code);
        runPlugin(exports, syntheticRequire, module, React);

        if (exports.activate && typeof exports.activate === 'function') {
          // [NEW] Create scoped API based on manifest permissions
          const scopedApi = createScopedAPI(api, manifest.id, manifest.permissions || []);
          
          // Pass scoped API instead of global API
          exports.activate(scopedApi);
          
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
      }
    } catch (e) {
      console.error(`Failed to load plugin ${manifest.id}:`, e);
    }
  }

  deactivateAll() {
    this.activePlugins.forEach(p => {
      if (p.instance.deactivate) {
        try { p.instance.deactivate(); } catch(e) { console.error(e); }
      }
    });
    this.activePlugins.clear();
    this.workerClient?.terminate();
    this.workerClient = null;
  }
}

export const pluginLoader = new PluginLoaderService();