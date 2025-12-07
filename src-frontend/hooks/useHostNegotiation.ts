import { useEffect } from "react";
import { useProjectStore } from "../stores/useProjectStore";
import { sessionService } from "../services";

export function useHostNegotiation() {
  const rootPath = useProjectStore(s => s.rootPath);

  useEffect(() => {
    if (rootPath) {
        sessionService.negotiateHost(rootPath);
    }
  }, [rootPath]);
}