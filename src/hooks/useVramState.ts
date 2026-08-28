import { useEffect, useState } from "react";
import { invokeRaven } from "./useInvoke";
import type { HealthStatus } from "../types/generated";

export function useVramState() {
  const [status, setStatus] = useState<HealthStatus | null>(null);

  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const h = await invokeRaven<HealthStatus>("health_check");
        if (active) setStatus(h);
      } catch {
        /* engine down */
      }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  return status;
}
