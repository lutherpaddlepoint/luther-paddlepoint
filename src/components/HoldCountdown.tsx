"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/** Shows mm:ss until the hold expires, then refreshes the page so it shows "expired". */
export default function HoldCountdown({ expiresAt }: { expiresAt: string }) {
  const router = useRouter();
  const end = new Date(expiresAt).getTime();
  const [left, setLeft] = useState(() => Math.max(0, end - Date.now()));

  useEffect(() => {
    const t = setInterval(() => {
      const ms = Math.max(0, end - Date.now());
      setLeft(ms);
      if (ms === 0) {
        clearInterval(t);
        setTimeout(() => router.refresh(), 1500);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [end, router]);

  const mm = Math.floor(left / 60000);
  const ss = String(Math.floor((left % 60000) / 1000)).padStart(2, "0");
  return (
    <span className="font-display text-5xl font-extrabold tabular-nums" role="timer" aria-live="off">
      {mm}:{ss}
    </span>
  );
}
