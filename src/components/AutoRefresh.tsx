"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-checks the page every few seconds (used while waiting for GCash to confirm). Stops after ~2 minutes. */
export default function AutoRefresh({ everyMs = 3000, maxTimes = 40 }: { everyMs?: number; maxTimes?: number }) {
  const router = useRouter();
  useEffect(() => {
    let n = 0;
    const t = setInterval(() => {
      if (++n > maxTimes) return clearInterval(t);
      router.refresh();
    }, everyMs);
    return () => clearInterval(t);
  }, [router, everyMs, maxTimes]);
  return null;
}
