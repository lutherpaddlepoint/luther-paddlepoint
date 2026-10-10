"use client";

import { useMemo, useState } from "react";
import ActionForm, { inputCls, labelCls } from "./ActionForm";
import { quoteCourt, quotePool, formatPeso, type RateRuleInput } from "@/lib/pricing";
import { formatMinute, toMinute } from "@/lib/time";
import type { ActionResult } from "@/lib/action-result";

type Props = {
  action: (fd: FormData) => Promise<ActionResult>;
  today: string;
  nowHour: number; // minute of the current hour, Manila
  openMinute: number;
  closeMinute: number;
  feePercent: number;
  courtRules: RateRuleInput[];
  poolRules: RateRuleInput[];
  sessions: { id: string; name: string; startMinute: number; endMinute: number }[];
};

const pad = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:00`;

export default function WalkInForm(p: Props) {
  const [amenity, setAmenity] = useState<"COURT" | "POOL">("COURT");
  const [date, setDate] = useState(p.today);
  const firstStart = Math.min(Math.max(p.openMinute, p.nowHour), p.closeMinute - 60);
  const [start, setStart] = useState(pad(firstStart));
  const [end, setEnd] = useState(pad(firstStart + 60));
  const [sessionId, setSessionId] = useState(
    p.sessions.find((s) => p.nowHour >= s.startMinute && p.nowHour < s.endMinute)?.id ?? p.sessions[0]?.id ?? "",
  );
  const [adults, setAdults] = useState(1);
  const [kids, setKids] = useState(0);
  const [paid, setPaid] = useState("FULL");
  const [method, setMethod] = useState("CASH");

  const quote = useMemo(() => {
    try {
      if (amenity === "COURT")
        return quoteCourt({ date, startMinute: toMinute(start), endMinute: toMinute(end), rules: p.courtRules,
          openMinute: p.openMinute, closeMinute: p.closeMinute, feePercent: p.feePercent });
      const s = p.sessions.find((x) => x.id === sessionId);
      return s ? quotePool({ date, sessionStartMinute: s.startMinute, adults, kids, rules: p.poolRules, feePercent: p.feePercent }) : null;
    } catch {
      return null;
    }
  }, [amenity, date, start, end, sessionId, adults, kids, p]);

  const hours: number[] = [];
  for (let m = p.openMinute; m <= p.closeMinute; m += 60) hours.push(m);
  const collectNow = !quote ? 0 : paid === "FULL" ? quote.totalCentavos : paid === "FEE" ? quote.reservationFeeCentavos : 0;

  return (
    <ActionForm action={p.action} submitLabel="Save booking" pendingLabel="Saving…" className="grid max-w-xl gap-4">
      <input type="hidden" name="amenity" value={amenity} />
      <div className="grid grid-cols-2 gap-2" role="radiogroup">
        {(["COURT", "POOL"] as const).map((a) => (
          <button key={a} type="button" role="radio" aria-checked={amenity === a} onClick={() => setAmenity(a)}
            className={`rounded-xl border-2 px-4 py-3 font-bold ${amenity === a ? "border-court bg-court text-white" : "border-line bg-white"}`}>
            {a === "COURT" ? "Pickleball court" : "Swimming pool"}
          </button>
        ))}
      </div>

      <label className={labelCls}>Date<input type="date" name="date" value={date} min={p.today} onChange={(e) => setDate(e.target.value)} className={inputCls} /></label>

      {amenity === "COURT" ? (
        <div className="grid grid-cols-3 gap-2">
          <label className={labelCls}>From
            <select name="start" value={start} onChange={(e) => setStart(e.target.value)} className={inputCls}>
              {hours.slice(0, -1).map((m) => <option key={m} value={pad(m)}>{formatMinute(m)}</option>)}
            </select>
          </label>
          <label className={labelCls}>To
            <select name="end" value={end} onChange={(e) => setEnd(e.target.value)} className={inputCls}>
              {hours.slice(1).map((m) => <option key={m} value={pad(m)}>{formatMinute(m)}</option>)}
            </select>
          </label>
          <label className={labelCls}>Players<input type="number" name="players" min={1} max={12} defaultValue={4} className={inputCls} /></label>
        </div>
      ) : (
        <>
          <label className={labelCls}>Session
            <select name="sessionId" value={sessionId} onChange={(e) => setSessionId(e.target.value)} className={inputCls}>
              {p.sessions.map((s) => <option key={s.id} value={s.id}>{s.name} ({formatMinute(s.startMinute)}–{formatMinute(s.endMinute)})</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className={labelCls}>Adults<input type="number" name="adults" min={1} value={adults} onChange={(e) => setAdults(Number(e.target.value))} className={inputCls} /></label>
            <label className={labelCls}>Kids (10 &amp; below)<input type="number" name="kids" min={0} value={kids} onChange={(e) => setKids(Number(e.target.value))} className={inputCls} /></label>
          </div>
        </>
      )}

      <div className="grid grid-cols-2 gap-2">
        <label className={labelCls}>Customer name<input name="name" required className={inputCls} /></label>
        <label className={labelCls}>Mobile (optional)<input name="mobile" inputMode="tel" placeholder="0917 123 4567" className={inputCls} /></label>
      </div>

      <fieldset className="rounded-xl border border-line bg-white p-4">
        <legend className="px-1 text-sm font-bold">Payment received now</legend>
        <div className="grid grid-cols-2 gap-2">
          <label className={labelCls}>Amount
            <select name="paid" value={paid} onChange={(e) => setPaid(e.target.value)} className={inputCls}>
              <option value="FULL">Full amount</option>
              <option value="FEE">Reservation fee only</option>
              <option value="NONE">Nothing yet</option>
            </select>
          </label>
          <label className={labelCls}>Method
            <select name="method" value={method} onChange={(e) => setMethod(e.target.value)} className={inputCls}>
              <option value="CASH">Cash</option>
              <option value="GCASH_MANUAL">GCash</option>
            </select>
          </label>
        </div>
        {method === "GCASH_MANUAL" && paid !== "NONE" && (
          <label className={`${labelCls} mt-2`}>GCash Ref. No.<input name="gcashReference" inputMode="numeric" className={inputCls} /></label>
        )}
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" name="checkInNow" defaultChecked className="h-4 w-4 accent-court" /> Customer is here now (check in)
        </label>
      </fieldset>

      <div className="rounded-xl bg-ball px-4 py-3 text-ink">
        {quote ? (
          <>
            <p className="font-display text-2xl font-semibold">Collect {formatPeso(collectNow)}</p>
            <p className="text-sm">Total {formatPeso(quote.totalCentavos)}{collectNow < quote.totalCentavos ? `, ${formatPeso(quote.totalCentavos - collectNow)} still due later` : ""}</p>
          </>
        ) : (
          <p className="text-sm">Choose a valid time to see the price.</p>
        )}
      </div>
    </ActionForm>
  );
}
