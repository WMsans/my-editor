import { invoke } from "@tauri-apps/api/core";
import { HostAPI, PluginManifest, DirectoryEntry, PluginModule, PluginExports, SyntheticRequire } from "./types";
import { registry } from "./Registry";
import { transform } from "sucrase"; 
import { WorkerClient } from "./worker/WorkerClient";
import { createScopedAPI } from "./HostAPIImpl";
import { fsService } from "../services";
import { FILES, CHANNELS } from "../constants";

import * as React from "react";
import * as TiptapReact from "@tiptap/react";
import * as TiptapCore from "@tiptap/core";

// --- Unified Plugin Controller Interface ---
interface PluginController {
    id: string;
    manifest: PluginManifest;
    activate(api: HostAPI): Promise<void>;
    deactivate(): Promise<void>;
    
    // Data Capabilities
    getTreeData(viewId: string, element?: unknown): Promise<unknown[]>;
    getTreeItem(viewId: string, element: unknown): Promise<unknown>;
}

// Controller for Main-Thread Plugins
class LocalPluginController implements PluginController {
    public instance: PluginExports = {};
    
    // In-memory storage for Main Thread Data Providers
    private treeProviders = new Map<string, any>();

    constructor(public id: string, public manifest: PluginManifest, private code: string) {}

    async activate(api: HostAPI) {
        const exports: PluginExports = {};
        const module: PluginModule = { exports };
        
        // Intercept createTreeView to capture providers locally
        const interceptedApi = {
            ...api,
            window: {
                ...api.window,
                createTreeView: (viewId: string, options: any) => {
                    this.treeProviders.set(viewId, options.treeDataProvider);
                    return api.window.createTreeView(viewId, options);
                }
            }
        };

        const syntheticRequire: SyntheticRequire = (modName: string) => {
          switch (modName) {
            case "react": return React;
            case "@tiptap/react": return TiptapReact;
            case "@tiptap/core": return TiptapCore;
            default: throw new Error(`Module '${modName}' is not available.`);
          }
        };

        const runPlugin = new Function("exports", "require", "module", "code", this.code);
        runPlugin(exports, syntheticRequire, module, this.code);

        this.instance = module.exports || exports;
        if (this.instance.activate) {
            await this.instance.activate(interceptedApi);
        }
    }

    async deactivate() {
        if (this.instance?.deactivate) {
            await this.instance.deactivate();
        }
        this.treeProviders.clear();
    }

    async getTreeData(viewId: string, element?: unknown): Promise<unknown[]> {
        const provider = this.treeProviders.get(viewId);
        if (provider) return await provider.getChildren(element);
        return [];
    }

    async getTreeItem(viewId: string, element: unknown): Promise<unknown> {
        const provider = this.treeProviders.get(viewId);
        if (provider) return await provider.getTreeItem(element);
        return {};
    }
}

// Controller for Worker Plugins
class WorkerPluginController implements PluginController {
    constructor(
        public id: string, 
        public manifest: PluginManifest, 
        private code: string,
        private workerClient: WorkerClient
    ) {}

    async activate() {
        this.workerClient.loadPlugin(this.id, this.code, this.manifest);
    }

    async deactivate() {
        this.workerClient.deactivatePlugin(this.id);
    }

    async getTreeData(viewId: string, element?: unknown) {
        return this.workerClient.requestTreeData(viewId, 'getChildren', element);
    }

    async getTreeItem(viewId: string, element: unknown) {
        return this.workerClient.requestTreeData(viewId, 'getTreeItem', element);
    }
}

class PluginLoaderService {
  private controllers: Map<string, PluginController> = new Map();
  private workerClient: WorkerClient | null = null;
  private allManifests: PluginManifest[] = [];
  
  async discoverPlugins(pluginsRootPath: string): Promise<PluginManifest[]> {
    try {
      const entries = await invoke<DirectoryEntry[]>(CHANNELS.READ_DIR, { path: pluginsRootPath });
      const manifests: PluginManifest[] = [];

      for (const entry of entries) {
        if (entry.is_dir) {
          const sep = entry.path.includes("\\") ? "\\" : "/";
          const configPath = `${entry.path}${sep}${FILES.PLUGIN_CONFIG}`;
          
          try {
            const configStr = await fsService.readFileString(configPath);
            const manifest: PluginManifest = JSON.parse(configStr);
            // Inject internal path
            (manifest as any)._rootPath = entry.path; 
            manifests.push(manifest);
          } catch (e) {
            // console.warn(`Skipping invalid plugin: ${entry.name}`);
          }
        }
      }
      this.allManifests = manifests;
      return manifests;
    } catch (e) {
      console.error("Failed to scan plugins:", e);
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
  
  getEnabledUniversalPlugins(): string[] {
      return this.allManifests
          .filter(m => m.isUniversal && this.isPluginEnabled(m.id))
          .map(m => m.id);
  }

  checkMissingRequirements(requiredIds: string[]): string[] {
      return requiredIds.filter(reqId => {
          const manifest = this.allManifests.find(m => m.id === reqId);
          return !manifest || !this.isPluginEnabled(reqId);
      });
  }

  async registerStaticContributions(manifests: PluginManifest[]) {
    for (const manifest of manifests) {
        if (this.isPluginEnabled(manifest.id)) {
            registry.registerManifest(manifest);
        }
    }
  }

  async loadPlugins(api: HostAPI, manifests: PluginManifest[]) {
    // Initialize Worker Client once if needed
    if (!this.workerClient && manifests.some(m => m.executionEnvironment === 'worker')) {
        this.workerClient = new WorkerClient(api);
    }

    for (const manifest of manifests) {
      if (!this.isPluginEnabled(manifest.id)) continue;
      await this.loadSinglePlugin(api, manifest);
    }
  }

  // --- Unified Data Bridge ---

  public async requestTreeViewData(viewId: string, element?: unknown) {
    const pluginId = registry.getPluginIdForView(viewId);
    if (!pluginId) return [];

    const controller = this.controllers.get(pluginId);
    if (controller) {
        return controller.getTreeData(viewId, element);
    }
    return [];
  }

  public async resolveTreeItem(viewId: string, element: unknown) {
    const pluginId = registry.getPluginIdForView(viewId);
    if (!pluginId) return {};

    const controller = this.controllers.get(pluginId);
    if (controller) {
        return controller.getTreeItem(viewId, element);
    }
    return {};
  }

  private async loadSinglePlugin(api: HostAPI, manifest: PluginManifest) {
    try {
      const root = (manifest as any)._rootPath;
      const sep = root.includes("\\") ? "\\" : "/";
      const mainPath = `${root}${sep}${manifest.main}`;
      const rawCode = await fsService.readFileString(mainPath);

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

      let controller: PluginController;

      if (manifest.executionEnvironment === 'worker') {
         if (!this.workerClient) this.workerClient = new WorkerClient(api);
         
         controller = new WorkerPluginController(
             manifest.id, 
             manifest, 
             code, 
             this.workerClient
         );
         await controller.activate(api);
      }
      else {
        controller = new LocalPluginController(manifest.id, manifest, code);
        const scopedApi = createScopedAPI(api, manifest.id, manifest.permissions || []);
        await controller.activate(scopedApi);
      }

      this.controllers.set(manifest.id, controller);

    } catch (e) {
      console.error(`Failed to load plugin ${manifest.id}:`, e);
    }
  }

  deactivateAll() {
    this.controllers.forEach(c => {
      try { c.deactivate(); } catch(e) { console.error(e); }
    });
    this.controllers.clear();
    this.workerClient?.terminate();
    this.workerClient = null;
  }
}

export const pluginLoader = new PluginLoaderService();