import { invoke } from "@tauri-apps/api/core";
import { HostAPI, PluginManifest, ActivePlugin } from "./types";
import { registry } from "./Registry";
import { transform } from "sucrase"; 
import { WorkerClient } from "./worker/WorkerClient";
import { createScopedAPI } from "./HostAPIImpl";

import * as React from "react";
import * as TiptapReact from "@tiptap/react";
import * as TiptapCore from "@tiptap/core";

interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

class PluginLoaderService {
  private activePlugins: Map<string, ActivePlugin> = new Map();
  private workerClient: WorkerClient | null = null;
  private allManifests: PluginManifest[] = [];

  // ... [Existing discoverPlugins, isPluginEnabled, setPluginEnabled methods remain unchanged] ...
  
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
      this.allManifests = manifests;
      return manifests;
    } catch (e) {
      console.error("Failed to scan plugins directory:", e);
      return [];
    }
  }

  isPluginEnabled(id: string): boolean {
    const disabled = JSON.parse(localStorage.getItem("disabled_plugins") || "[]");
    return !disabled.includes(id);
  }

  setPluginEnabled(id: string, enabled: boolean) {
    let disabled = JSON.parse(localStorage.getItem("disabled_plugins") || "[]");
    if (enabled) {
        disabled = disabled.filter((x: string) => x !== id);
    } else {
        if (!disabled.includes(id)) disabled.push(id);
    }
    localStorage.setItem("disabled_plugins", JSON.stringify(disabled));
  }
  
  getAllManifests() { return this.allManifests; }

  async registerStaticContributions(manifests: PluginManifest[]) {
    for (const manifest of manifests) {
        if (this.isPluginEnabled(manifest.id)) {
            registry.registerManifest(manifest);
        }
    }
  }

  async loadPlugins(api: HostAPI, manifests: PluginManifest[]) {
    if (!this.workerClient) {
        this.workerClient = new WorkerClient(api);
    }

    for (const manifest of manifests) {
      if (!this.isPluginEnabled(manifest.id)) {
          console.log(`⏸️ Plugin '${manifest.id}' is disabled.`);
          continue;
      }
      await this.loadSinglePlugin(api, manifest);
    }
  }

  // --- [PHASE 3] Data Bridge for UI ---

  public async requestTreeViewData(viewId: string, element?: any) {
    if (!this.workerClient) return [];
    // 'getChildren' returns the raw data objects
    return this.workerClient.requestTreeData(viewId, 'getChildren', element);
  }

  // [NEW] Resolve the UI representation (label, icon) for a data element
  public async resolveTreeItem(viewId: string, element: any) {
    if (!this.workerClient) return {};
    return this.workerClient.requestTreeData(viewId, 'getTreeItem', element);
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
         console.log(`🚀 Loading ${manifest.name} in Worker...`);
         this.workerClient?.loadPlugin(manifest.id, code, manifest);
         
         this.activePlugins.set(manifest.id, {
             manifest,
             instance: { 
                 deactivate: () => {
                     this.workerClient?.deactivatePlugin(manifest.id);
                 }
             }
         });
      }
      else {
        // [FIX] Main thread logic: Expose React and Tiptap to the synthetic 'require'
        const exports: any = {};
        const module = { exports };
        
        const syntheticRequire = (modName: string) => {
          switch (modName) {
            case "react": return React;
            case "@tiptap/react": return TiptapReact;
            case "@tiptap/core": return TiptapCore;
            default:
              throw new Error(`Module '${modName}' is not available. Use the Host API.`);
          }
        };

        const runPlugin = new Function("exports", "require", "module", "code", code);
        runPlugin(exports, syntheticRequire, module, code);

        if (exports.activate && typeof exports.activate === 'function') {
          const scopedApi = createScopedAPI(api, manifest.id, manifest.permissions || []);
          exports.activate(scopedApi);
          this.activePlugins.set(manifest.id, { manifest, instance: exports });
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