import { useEffect } from "react";
import { useProjectStore } from "../../core/stores/useProjectStore";
import { sessionService } from "../../core/services";

export function useHostNegotiation() {
  const rootPath = useProjectStore(s => s.rootPath);

  useEffect(() => {
    if (rootPath) {
        sessionService.negotiateHost(rootPath);
    }
  }, [rootPath]);
}