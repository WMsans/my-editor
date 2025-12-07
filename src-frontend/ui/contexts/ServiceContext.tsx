import React, { createContext, useContext, ReactNode } from "react";
import { registry } from "../../engine/registry/Registry";
import { pluginLoader } from "../../engine/PluginLoader";
import { commandService } from "../../engine/api/CommandService";
import {
  p2pService,
  sessionService,
  fsService,
  authService,
  collabService,
  workspaceManager,
} from "../../core/services";
// Define the shape of our service container
interface ServiceContainer {
  registry: typeof registry;
  pluginLoader: typeof pluginLoader;
  commandService: typeof commandService;
  workspaceManager: typeof workspaceManager;
  p2pService: typeof p2pService;
  fsService: typeof fsService;
  authService: typeof authService;
  collabService: typeof collabService;
  sessionService: typeof sessionService;
}

// Create the singleton object (existing logic)
const services: ServiceContainer = {
  registry,
  pluginLoader,
  commandService,
  workspaceManager,
  p2pService,
  fsService,
  authService,
  collabService,
  sessionService
};

const ServiceContext = createContext<ServiceContainer>(services);

export const ServiceProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  return (
    <ServiceContext.Provider value={services}>
      {children}
    </ServiceContext.Provider>
  );
};

// Custom hook for easy access
export const useServices = () => {
  const context = useContext(ServiceContext);
  if (!context) {
    throw new Error("useServices must be used within a ServiceProvider");
  }
  return context;
};