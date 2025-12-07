import { useState, useEffect, useCallback } from "react";
import { useServices } from "../contexts/ServiceContext";

/**
 * Hook to fetch tree data for a specific view node (or root).
 */
export function useTreeData(viewId: string, parentItem?: any) {
  const { pluginLoader } = useServices();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Get raw data
      const rawItems = await pluginLoader.requestTreeViewData(viewId, parentItem);
      
      if (Array.isArray(rawItems)) {
        // 2. Resolve UI properties (Parallel resolution)
        const resolved = await Promise.all(rawItems.map(async (child: any) => {
            const ui = await pluginLoader.resolveTreeItem(viewId, child);
            return { ...child, ...(ui as any) };
        }));
        setItems(resolved);
      } else {
        setItems([]);
      }
    } catch (e: any) {
      console.error("Tree data fetch error:", e);
      setError(e.toString());
    } finally {
      setLoading(false);
    }
  }, [viewId, parentItem, pluginLoader]);

  // Initial load for root items only
  useEffect(() => {
    if (!parentItem) {
        fetchData();
    }
  }, [fetchData, parentItem]);

  return { items, loading, error, fetchData };
}