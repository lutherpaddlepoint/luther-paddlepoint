"use client";

import { useEffect, useState } from "react";

const clock = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" });
const day = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", weekday: "long", month: "short", day: "numeric" });

function left(ms: number) {
  const m = Math.ceil(ms / 60_000);
  if (m >= 60) return `${Math.floor(m / 60)} hr ${m % 60} min left`;
  return `${m} min left`;
}

/**
 * Big live clock for the TV screens (Manila time). With `startsAt`/`endsAt`
 * it also shows how long until open play starts, or how much time is left.
 */
export default function TvClock({ startsAt, endsAt }: { startsAt?: string; endsAt?: string }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(t);
  }, []);
  if (!now) return <div className="h-16" aria-hidden />;

  const start = startsAt ? new Date(startsAt).getTime() : null;
  const end = endsAt ? new Date(endsAt).getTime() : null;
  const t = now.getTime();
  let note: string | null = null;
  if (start && t < start) note = `Starts in ${left(start - t).replace(" left", "")}`;
  else if (end && t < end) note = left(end - t);
  else if (end && t >= end) note = "Time's up";

  return (
    <div className="text-right" aria-live="off">
      <p className="font-display text-5xl font-extrabold leading-none tabular-nums md:text-6xl">{clock.format(now)}</p>
      <p className="mt-1 text-sm text-white/70 md:text-base">{day.format(now)}</p>
      {note && <p className="mt-1 font-display text-lg font-bold text-ball md:text-xl">{note}</p>}
    </div>
  );
}
