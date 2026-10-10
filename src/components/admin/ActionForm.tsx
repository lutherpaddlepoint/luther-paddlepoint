"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";

type Props = {
  action: (fd: FormData) => Promise<ActionResult>;
  children?: React.ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  confirm?: string; // asks "Are you sure?" first
  tone?: "primary" | "danger" | "plain";
  className?: string;
  resetOnSuccess?: boolean;
  full?: boolean;
};

const TONES = {
  primary: "bg-court text-white",
  danger: "bg-red-700 text-white",
  plain: "border border-line bg-white text-ink",
};

/** A form that runs a server action, then shows the result and refreshes the page data. */
export default function ActionForm(p: Props) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (p.confirm && !window.confirm(p.confirm)) return;
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const r = await p.action(fd);
      setResult(r);
      if (r.ok && r.redirect) return router.push(r.redirect);
      if (r.ok) {
        if (p.resetOnSuccess) formRef.current?.reset();
        router.refresh();
      }
    });
  };

  return (
    <form ref={formRef} onSubmit={onSubmit} className={p.className}>
      {p.children}
      <button
        type="submit"
        disabled={pending}
        className={`mt-3 rounded-xl px-4 py-2.5 font-bold disabled:opacity-60 ${TONES[p.tone ?? "primary"]} ${p.full ? "w-full" : ""}`}
      >
        {pending ? p.pendingLabel ?? "Saving…" : p.submitLabel}
      </button>
      {result && !result.ok && (
        <p role="alert" className="mt-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{result.error}</p>
      )}
      {result?.ok && result.message && (
        <div role="status" className="mt-2 rounded-lg border border-court/30 bg-court/5 px-3 py-2 text-sm text-court">
          {result.message}
          {result.secret && <p className="mt-1 select-all font-display text-xl font-bold tracking-wider text-ink">{result.secret}</p>}
        </div>
      )}
    </form>
  );
}

export const inputCls = "mt-1 block w-full rounded-lg border border-line bg-white px-3 py-2";
export const labelCls = "block text-sm font-bold";
