"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import QrScanner from "./QrScanner";
import type { ActionResult } from "@/lib/action-result";

export default function CheckInFinder({ find }: { find: (fd: FormData) => Promise<ActionResult> }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const open = useCallback(
    (c: string) => {
      setError(null);
      const fd = new FormData();
      fd.set("code", c);
      start(async () => {
        const r = await find(fd);
        if (r.ok && r.redirect) router.push(r.redirect);
        else if (!r.ok) setError(r.error);
      });
    },
    [find, router],
  );

  return (
    <div className="grid max-w-md gap-6">
      <QrScanner onCode={open} />
      <form onSubmit={(e) => { e.preventDefault(); open(code); }} className="flex items-end gap-2">
        <label className="flex-1 text-sm font-bold">
          Or type the reference code
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="LPP-7K3QX" autoComplete="off"
            className="mt-1 block w-full rounded-lg border border-line bg-white px-3 py-2 text-lg uppercase tracking-wider" />
        </label>
        <button disabled={pending} className="rounded-xl bg-court px-4 py-2.5 font-bold text-white disabled:opacity-60">{pending ? "Finding…" : "Find"}</button>
      </form>
      {error && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
    </div>
  );
}
