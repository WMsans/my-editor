import { useState, useEffect } from "react";
import { useServices } from "../contexts/ServiceContext";
import { RegisteredTopbarItem } from "../../engine/types";

export function useTopbar() {
  const { registry } = useServices();
  const [items, setItems] = useState<RegisteredTopbarItem[]>([]);

  useEffect(() => {
    // Initial fetch
    setItems([...registry.getTopbarItems()]);

    // Subscribe to changes
    const unsubscribe = registry.subscribe(() => {
      setItems([...registry.getTopbarItems()]);
    });

    return () => unsubscribe();
  }, [registry]);

  return { items };
}