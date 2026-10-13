"use client";

import { useEffect, useRef, useState } from "react";

const WARN_AT_MS = 5 * 60_000;
const ALARM_SECONDS = 20;

function fmt(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  return `${h ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

/**
 * Big court countdown for the TV. Beeps twice at 5 minutes left and sounds an alarm for
 * 20 seconds when time is up. Browsers only allow sound after someone clicks the page once,
 * so the screen asks for one click to turn the alarm on.
 */
export default function TvCountdown({ endsAt, label, serverNow }: { endsAt: string; label: string; serverNow: number }) {
  const [now, setNow] = useState<number | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  const offset = useRef(0); // TV clock vs server clock
  const fired = useRef({ key: "", warn: false, alarm: false });

  useEffect(() => {
    offset.current = serverNow - Date.now();
  }, [serverNow]);

  useEffect(() => {
    setNow(Date.now() + offset.current);
    const t = setInterval(() => setNow(Date.now() + offset.current), 250);
    return () => clearInterval(t);
  }, []);

  const beep = (freq: number, ms: number, at = 0) => {
    const ctx = audio.current;
    if (!ctx || ctx.state !== "running") return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "square";
    o.frequency.value = freq;
    const t0 = ctx.currentTime + at;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.35, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000);
    o.connect(g).connect(ctx.destination);
    o.start(t0);
    o.stop(t0 + ms / 1000 + 0.02);
  };

  const enableSound = async () => {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio.current ??= new Ctx();
    await audio.current.resume();
    setSoundOn(audio.current.state === "running");
    beep(880, 150); // test beep so staff know it works
  };

  const end = Date.parse(endsAt);
  const left = now === null ? null : end - now;

  useEffect(() => {
    if (left === null) return;
    if (fired.current.key !== endsAt) {
      // New or extended timer: don't replay warnings that already passed.
      fired.current = { key: endsAt, warn: left <= WARN_AT_MS, alarm: left <= 0 };
      return;
    }
    if (!fired.current.warn && left <= WARN_AT_MS && left > 0) {
      fired.current.warn = true;
      beep(880, 200);
      beep(880, 200, 0.35);
    }
    if (!fired.current.alarm && left <= 0) {
      fired.current.alarm = true;
      for (let i = 0; i < ALARM_SECONDS; i++) {
        beep(1046, 180, i);
        beep(784, 180, i + 0.25);
        beep(1046, 180, i + 0.5);
      }
    }
  }, [left, endsAt]); // eslint-disable-line react-hooks/exhaustive-deps

  if (left === null) return <div className="h-40" aria-hidden />;
  const up = left <= 0;
  const warn = !up && left <= WARN_AT_MS;

  return (
    <section
      aria-label="Court countdown"
      className={`rounded-3xl p-5 text-center ${up ? "animate-pulse bg-red-600" : warn ? "bg-ball text-ink" : "bg-white/10"}`}
    >
      <p className="font-display text-xl font-semibold md:text-2xl">{label}</p>
      <p className="font-display text-[5.5rem] font-extrabold leading-none tabular-nums md:text-[9rem]">{up ? "TIME'S UP" : fmt(left)}</p>
      <p className="mt-1 text-lg font-bold md:text-xl">{up ? "Please finish your game. Thank you!" : warn ? "5 minutes left" : "Time left on the court"}</p>
      {!soundOn && (
        <button type="button" onClick={enableSound} className="mt-3 rounded-xl bg-white px-4 py-2 text-base font-bold text-ink">
          🔔 Click once to turn on the alarm sound
        </button>
      )}
    </section>
  );
}
