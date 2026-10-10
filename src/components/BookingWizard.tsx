"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Availability } from "@/lib/availability";
import type { CourtSlot, PoolSessionView } from "@/lib/availability-core";
import { quoteCourt, quotePool, formatPeso, type PriceQuote } from "@/lib/pricing";
import { toggleSlot, rangeStillAvailable, type Range } from "@/lib/selection";
import { addDays, formatMinute, manilaToUtc, todayInManila } from "@/lib/time";

type Amenity = "COURT" | "POOL";
type Step = "choose" | "details";

const fmtDate = (date: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", ...opts }).format(manilaToUtc(date, 12 * 60));

const peso = (c: number) => formatPeso(c).replace(".00", "");

export default function BookingWizard() {
  const router = useRouter();
  const today = todayInManila();

  const [amenity, setAmenity] = useState<Amenity>("COURT");
  const [date, setDate] = useState(today);
  const [data, setData] = useState<Availability | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [range, setRange] = useState<Range>(null);
  const [players, setPlayers] = useState(4);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [adults, setAdults] = useState(1);
  const [kids, setKids] = useState(0);

  const [step, setStep] = useState<Step>("choose");

  const load = useCallback(async (d: string, signal?: AbortSignal) => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/availability?date=${d}`, { signal, cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not load the schedule.");
      setData(json);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setLoadError((e as Error).message || "Could not load the schedule.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    load(date, ctrl.signal);
    return () => ctrl.abort();
  }, [date, load]);

  // If a refresh shows the chosen time is no longer free, clear it and say why.
  useEffect(() => {
    if (!data) return;
    if (range && data.court) {
      const free = (m: number) => data.court!.slots.some((s) => s.startMinute === m && s.status === "available");
      if (!rangeStillAvailable(range, free)) {
        setRange(null);
        setNotice("Part of the time you picked was just booked. Please choose again.");
      }
    }
    if (sessionId && data.pool) {
      const s = data.pool.sessions.find((x) => x.id === sessionId);
      if (!s || s.status !== "available" || s.remaining < adults + kids) {
        setSessionId(null);
        setNotice("That pool session no longer has enough spots. Please choose again.");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const pickDate = (d: string) => {
    if (d === date) return;
    setDate(d);
    setRange(null);
    setSessionId(null);
    setNotice(null);
  };

  const pickAmenity = (a: Amenity) => {
    setAmenity(a);
    setNotice(null);
  };

  const quote: PriceQuote | null = useMemo(() => {
    if (!data) return null;
    try {
      if (amenity === "COURT" && range && data.court)
        return quoteCourt({
          date, startMinute: range.start, endMinute: range.end, rules: data.court.rules,
          openMinute: data.openMinute, closeMinute: data.closeMinute, feePercent: data.feePercent, minHours: data.minHours,
        });
      if (amenity === "POOL" && sessionId && data.pool) {
        const s = data.pool.sessions.find((x) => x.id === sessionId);
        if (!s || adults + kids > s.remaining) return null;
        return quotePool({ date, sessionStartMinute: s.startMinute, adults, kids, rules: data.pool.rules, feePercent: data.feePercent });
      }
    } catch {
      return null;
    }
    return null;
  }, [data, amenity, range, sessionId, adults, kids, date]);

  const selectedSession = data?.pool?.sessions.find((s) => s.id === sessionId) ?? null;
  const lastDate = data?.lastDate ?? addDays(today, 29);
  const dates = useMemo(() => {
    const out: string[] = [];
    for (let d = today; d <= lastDate; d = addDays(d, 1)) out.push(d);
    return out;
  }, [today, lastDate]);

  const summaryLine =
    amenity === "COURT" && range
      ? `${formatMinute(range.start)} to ${formatMinute(range.end)}, ${players} player${players === 1 ? "" : "s"}`
      : selectedSession
        ? `${selectedSession.name}, ${formatMinute(selectedSession.startMinute)} to ${formatMinute(selectedSession.endMinute)}`
        : "";

  if (step === "details" && quote && data) {
    return (
      <DetailsStep
        amenity={amenity}
        date={date}
        summaryLine={summaryLine}
        quote={quote}
        guestsLine={amenity === "POOL" ? `${adults} adult${adults === 1 ? "" : "s"}${kids ? `, ${kids} kid${kids === 1 ? "" : "s"}` : ""}` : ""}
        payload={
          amenity === "COURT" && range && data.court
            ? { amenity, amenityId: data.court.id, date, startMinute: range.start, endMinute: range.end, players }
            : { amenity, sessionId, date, adults, kids }
        }
        onBack={() => setStep("choose")}
        onConflict={(msg) => {
          setStep("choose");
          setNotice(msg);
          load(date);
        }}
        onDone={(url) => router.push(url)}
      />
    );
  }

  const court = data?.court;
  const pool = data?.pool;
  const courtRates = court ? Array.from(new Set(court.rules.map((r) => r.priceCentavos))).sort((a, b) => a - b) : [];
  const poolAdult = pool?.rules.find((r) => r.guestType === "ADULT")?.priceCentavos;
  const poolKid = pool?.rules.find((r) => r.guestType === "KID")?.priceCentavos;

  return (
    <div className="pb-36">
      {/* What to book */}
      <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="What would you like to book?">
        <AmenityButton
          active={amenity === "COURT"}
          onClick={() => pickAmenity("COURT")}
          title="Pickleball court"
          detail={courtRates.length ? `${courtRates.map(peso).join(" to ")} per hour` : "Per hour"}
          tone="court"
        />
        <AmenityButton
          active={amenity === "POOL"}
          onClick={() => pickAmenity("POOL")}
          title="Swimming pool"
          detail={poolAdult != null ? `${peso(poolAdult)} adult, ${peso(poolKid ?? 0)} kid` : "Per person"}
          tone="pool"
        />
      </div>

      {/* When */}
      <h2 className="mt-8 font-display text-xl font-semibold">
        {fmtDate(date, { weekday: "long", month: "long", day: "numeric" })}
      </h2>
      <div className="no-scrollbar -mx-5 mt-3 flex gap-2 overflow-x-auto px-5 pb-1" aria-label="Choose a date">
        {dates.map((d) => {
          const active = d === date;
          return (
            <button
              key={d}
              type="button"
              onClick={() => pickDate(d)}
              aria-pressed={active}
              className={`flex w-14 shrink-0 flex-col items-center rounded-xl border py-2 ${
                active ? "border-ink bg-ink text-paper" : "border-line bg-white text-ink"
              }`}
            >
              <span className="text-xs">{d === today ? "Today" : fmtDate(d, { weekday: "short" })}</span>
              <span className="font-display text-lg font-semibold leading-tight">{fmtDate(d, { day: "numeric" })}</span>
              <span className="text-[11px] opacity-70">{fmtDate(d, { month: "short" })}</span>
            </button>
          );
        })}
      </div>

      {notice && (
        <p role="status" className="mt-5 rounded-lg border border-dusk/30 bg-dusk/5 px-4 py-3 text-sm text-dusk">
          {notice}
        </p>
      )}

      {loadError && (
        <div className="mt-6 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {loadError}{" "}
          <button type="button" className="font-bold underline" onClick={() => load(date)}>
            Try again
          </button>
        </div>
      )}

      {loading && !data && <p className="mt-8 text-muted">Loading the schedule…</p>}

      {data && amenity === "COURT" && (
        court ? (
          <CourtTimeline
            slots={court.slots}
            range={range}
            loading={loading}
            onTap={(m) => {
              setNotice(null);
              setRange((r) => toggleSlot(r, m, (x) => court.slots.some((s) => s.startMinute === x && s.status === "available")));
            }}
            players={players}
            setPlayers={setPlayers}
          />
        ) : (
          <p className="mt-8 text-muted">The court isn’t open for online booking right now.</p>
        )
      )}

      {data && amenity === "POOL" && (
        pool ? (
          <PoolPicker
            sessions={pool.sessions}
            selectedId={sessionId}
            onSelect={(id) => {
              setNotice(null);
              setSessionId(id);
            }}
            adults={adults}
            kids={kids}
            setAdults={setAdults}
            setKids={setKids}
            adultPrice={poolAdult}
            kidPrice={poolKid}
            lightsOnMinute={data.lightsOnMinute}
          />
        ) : (
          <p className="mt-8 text-muted">The pool isn’t open for online booking right now.</p>
        )
      )}

      {/* Sticky total */}
      <div className="fixed inset-x-0 bottom-0 border-t border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-xl items-center gap-4 px-5 py-3">
          <div className="min-w-0 flex-1">
            {quote ? (
              <>
                <p className="font-display text-2xl font-semibold leading-none">{peso(quote.totalCentavos)}</p>
                <p className="mt-1 truncate text-sm text-muted">
                  {peso(quote.reservationFeeCentavos)} now to reserve, rest on-site
                </p>
              </>
            ) : (
              <p className="text-sm text-muted">
                {amenity === "COURT" ? "Tap the hours you want to play." : "Choose a session and your guests."}
              </p>
            )}
          </div>
          <button
            type="button"
            disabled={!quote}
            onClick={() => setStep("details")}
            className="rounded-xl bg-court px-6 py-3 font-bold text-white disabled:cursor-not-allowed disabled:bg-line disabled:text-muted"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

function AmenityButton(props: { active: boolean; onClick: () => void; title: string; detail: string; tone: "court" | "pool" }) {
  const activeCls = props.tone === "court" ? "border-court bg-court text-white" : "border-pool bg-pool text-white";
  return (
    <button
      type="button"
      role="radio"
      aria-checked={props.active}
      onClick={props.onClick}
      className={`rounded-2xl border-2 px-4 py-4 text-left ${props.active ? activeCls : "border-line bg-white text-ink"}`}
    >
      <span className="block font-display text-lg font-semibold leading-tight">{props.title}</span>
      <span className={`mt-1 block text-sm ${props.active ? "text-white/85" : "text-muted"}`}>{props.detail}</span>
    </button>
  );
}

const STATUS_TEXT: Record<CourtSlot["status"], string> = {
  available: "Open",
  booked: "Booked",
  blocked: "Closed",
  past: "Passed",
};

function CourtTimeline(props: {
  slots: CourtSlot[];
  range: Range;
  loading: boolean;
  onTap: (m: number) => void;
  players: number;
  setPlayers: (n: number) => void;
}) {
  const { slots, range } = props;
  const firstNight = slots.find((s) => s.isNight);
  const nightPrice = firstNight?.priceCentavos;

  if (slots.every((s) => s.status === "past")) {
    return <p className="mt-8 text-muted">Court hours for this day have passed. Pick another date.</p>;
  }

  return (
    <section className="mt-6" aria-busy={props.loading}>
      <ol className="overflow-hidden rounded-2xl border border-line">
        {slots.map((s) => {
          const selected = !!range && s.startMinute >= range.start && s.startMinute < range.end;
          const open = s.status === "available";
          const base = s.isNight ? "bg-dusk text-white" : "bg-white text-ink";
          const look = selected ? "bg-ball text-ink" : base;
          return (
            <li key={s.startMinute}>
              {s === firstNight && (
                <div className="bg-dusk px-4 pb-2 pt-4 text-sm text-white/80">
                  Court lights on from {s.label}. Night rate {nightPrice != null ? `${peso(nightPrice)}/hour` : "applies"}.
                </div>
              )}
              <button
                type="button"
                disabled={!open}
                aria-pressed={selected}
                onClick={() => props.onTap(s.startMinute)}
                className={`flex w-full items-center gap-4 border-t px-4 py-3 text-left ${look} ${
                  s.isNight ? "border-white/10" : "border-line"
                } ${open ? "" : "cursor-not-allowed"}`}
              >
                <span className={`w-20 font-display text-lg font-semibold ${open || selected ? "" : "opacity-40"}`}>
                  {s.label}
                </span>
                <span className={`flex-1 text-sm ${open || selected ? "opacity-80" : "opacity-40"}`}>
                  {peso(s.priceCentavos)}
                </span>
                <span
                  className={`text-sm ${
                    selected ? "font-bold" : open ? (s.isNight ? "text-white/90" : "text-court") : "line-through opacity-50"
                  }`}
                >
                  {selected ? "Selected" : STATUS_TEXT[s.status]}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-sm text-muted">Tap one hour, then the next to add more. Bookings are in whole hours.</p>

      <div className="mt-6 flex items-center justify-between rounded-2xl border border-line bg-white px-4 py-3">
        <div>
          <p className="font-bold">Players</p>
          <p className="text-sm text-muted">Same price for any number</p>
        </div>
        <Counter value={props.players} min={1} max={12} onChange={props.setPlayers} label="players" />
      </div>
    </section>
  );
}

function PoolPicker(props: {
  sessions: PoolSessionView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  adults: number;
  kids: number;
  setAdults: (n: number) => void;
  setKids: (n: number) => void;
  adultPrice?: number;
  kidPrice?: number;
  lightsOnMinute: number;
}) {
  const selected = props.sessions.find((s) => s.id === props.selectedId);
  const maxGuests = selected ? selected.remaining : 30;
  const total = props.adults + props.kids;

  return (
    <section className="mt-6">
      <div className="grid gap-3">
        {props.sessions.map((s) => {
          const isSel = s.id === props.selectedId;
          const night = s.startMinute >= props.lightsOnMinute;
          const open = s.status === "available";
          const filled = Math.round((s.reserved / s.capacity) * 100);
          const statusText =
            s.status === "available" ? `${s.remaining} of ${s.capacity} spots left`
            : s.status === "full" ? "Full"
            : s.status === "closed" ? "Closed for this day"
            : "Online booking closed";
          return (
            <button
              key={s.id}
              type="button"
              disabled={!open}
              aria-pressed={isSel}
              onClick={() => props.onSelect(s.id)}
              className={`rounded-2xl border-2 p-4 text-left ${
                isSel ? "border-ink bg-ball text-ink" : night ? "border-dusk bg-dusk text-white" : "border-line bg-white text-ink"
              } ${open ? "" : "cursor-not-allowed opacity-50"}`}
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className="font-display text-lg font-semibold">{s.name}</span>
                <span className="text-sm">
                  {formatMinute(s.startMinute)} to {formatMinute(s.endMinute)}
                </span>
              </span>
              <span className="relative mt-3 block h-2 overflow-hidden rounded-full" aria-hidden>
                <span className="absolute inset-0 bg-current opacity-20" />
                <span className="relative block h-full rounded-full bg-current" style={{ width: `${filled}%` }} />
              </span>
              <span className="mt-2 block text-sm">{statusText}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-6 divide-y divide-line rounded-2xl border border-line bg-white">
        <div className="flex items-center justify-between px-4 py-3">
          <div>
            <p className="font-bold">Adults</p>
            <p className="text-sm text-muted">{props.adultPrice != null ? peso(props.adultPrice) : ""} each</p>
          </div>
          <Counter value={props.adults} min={1} max={Math.max(1, maxGuests - props.kids)} onChange={props.setAdults} label="adults" />
        </div>
        <div className="flex items-center justify-between px-4 py-3">
          <div>
            <p className="font-bold">Kids, 10 and below</p>
            <p className="text-sm text-muted">{props.kidPrice != null ? peso(props.kidPrice) : ""} each</p>
          </div>
          <Counter value={props.kids} min={0} max={Math.max(0, maxGuests - props.adults)} onChange={props.setKids} label="kids" />
        </div>
      </div>
      {selected && total > selected.remaining && (
        <p className="mt-3 text-sm text-red-700">Only {selected.remaining} spots left in this session.</p>
      )}
      <p className="mt-3 text-sm text-muted">Kids must come with at least one adult.</p>
    </section>
  );
}

function Counter(props: { value: number; min: number; max: number; onChange: (n: number) => void; label: string }) {
  const btn = "grid h-10 w-10 place-items-center rounded-full border border-line text-xl disabled:opacity-30";
  return (
    <div className="flex items-center gap-3">
      <button type="button" className={btn} aria-label={`Fewer ${props.label}`} disabled={props.value <= props.min}
        onClick={() => props.onChange(Math.max(props.min, props.value - 1))}>
        −
      </button>
      <span className="w-6 text-center font-display text-lg font-semibold" aria-live="polite">{props.value}</span>
      <button type="button" className={btn} aria-label={`More ${props.label}`} disabled={props.value >= props.max}
        onClick={() => props.onChange(Math.min(props.max, props.value + 1))}>
        +
      </button>
    </div>
  );
}

function DetailsStep(props: {
  amenity: Amenity;
  date: string;
  summaryLine: string;
  guestsLine: string;
  quote: PriceQuote;
  payload: Record<string, unknown>;
  onBack: () => void;
  onConflict: (msg: string) => void;
  onDone: (url: string) => void;
}) {
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [agreePolicy, setAgreePolicy] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  const [website, setWebsite] = useState(""); // honeypot
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { quote } = props;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrors({});
    setFormError(null);
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...props.payload, name, mobile, email, agreePolicy, agreePrivacy, website }),
      });
      const json = await res.json();
      if (res.status === 201) return props.onDone(json.url);
      if (res.status === 409) return props.onConflict(json.error);
      setErrors(json.fieldErrors ?? {});
      setFormError(json.error ?? "Booking could not be saved. Please try again.");
    } catch {
      setFormError("No connection. Check your internet and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const field = "mt-1 block w-full rounded-xl border border-line bg-white px-4 py-3 text-base";

  return (
    <form onSubmit={submit} noValidate className="pb-10">
      <button type="button" onClick={props.onBack} className="text-sm font-bold text-court underline">
        Change {props.amenity === "COURT" ? "time" : "session or guests"}
      </button>

      <section className="mt-4 rounded-2xl border border-line bg-white p-5">
        <h2 className="font-display text-xl font-semibold">
          {props.amenity === "COURT" ? "Pickleball court" : "Swimming pool"}
        </h2>
        <p className="mt-1">{fmtDate(props.date, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</p>
        <p className="text-muted">{props.summaryLine}</p>
        {props.guestsLine && <p className="text-muted">{props.guestsLine}</p>}

        <table className="mt-4 w-full text-sm">
          <tbody>
            {quote.lineItems.map((li) => (
              <tr key={li.description}>
                <td className="py-1 pr-2">{li.description}{li.quantity > 1 ? ` × ${li.quantity}` : ""}</td>
                <td className="py-1 text-right">{formatPeso(li.amountCentavos)}</td>
              </tr>
            ))}
            <tr className="border-t border-line font-bold">
              <td className="pt-2">Total</td>
              <td className="pt-2 text-right">{formatPeso(quote.totalCentavos)}</td>
            </tr>
            <tr>
              <td className="py-1">Reservation fee, pay now with GCash</td>
              <td className="py-1 text-right font-bold">{formatPeso(quote.reservationFeeCentavos)}</td>
            </tr>
            <tr className="text-muted">
              <td>Balance, pay on-site</td>
              <td className="text-right">{formatPeso(quote.balanceCentavos)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <h2 className="mt-8 font-display text-xl font-semibold">Your details</h2>
      <div className="mt-4 grid gap-4">
        <label className="block">
          <span className="font-bold">Full name</span>
          <input className={field} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required aria-invalid={!!errors.name} />
          {errors.name && <span className="mt-1 block text-sm text-red-700">{errors.name}</span>}
        </label>
        <label className="block">
          <span className="font-bold">Mobile number</span>
          <input className={field} value={mobile} onChange={(e) => setMobile(e.target.value)} inputMode="tel" autoComplete="tel"
            placeholder="0917 123 4567" required aria-invalid={!!errors.mobile} />
          {errors.mobile && <span className="mt-1 block text-sm text-red-700">{errors.mobile}</span>}
        </label>
        <label className="block">
          <span className="font-bold">Email</span>
          <span className="block text-sm text-muted">Your confirmation and QR code are sent here.</span>
          <input className={field} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email"
            required aria-invalid={!!errors.email} />
          {errors.email && <span className="mt-1 block text-sm text-red-700">{errors.email}</span>}
        </label>
        {/* Honeypot: hidden from people, bots fill it in */}
        <label className="absolute -left-[9999px]" aria-hidden>
          Website
          <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </label>
      </div>

      <div className="mt-6 grid gap-3 rounded-2xl border border-line bg-white p-4 text-sm">
        <label className="flex gap-3">
          <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-court" checked={agreePolicy} onChange={(e) => setAgreePolicy(e.target.checked)} />
          <span>
            I understand the reservation fee of <strong>{formatPeso(quote.reservationFeeCentavos)}</strong> is non-refundable.
            The balance is paid on-site. I can reschedule once if I ask at least 24 hours before my booking.
          </span>
        </label>
        {errors.agreePolicy && <span className="text-red-700">{errors.agreePolicy}</span>}
        <label className="flex gap-3">
          <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-court" checked={agreePrivacy} onChange={(e) => setAgreePrivacy(e.target.checked)} />
          <span>
            I agree to the{" "}
            <a href="/privacy" target="_blank" className="font-bold text-court underline">privacy notice</a>.
          </span>
        </label>
        {errors.agreePrivacy && <span className="text-red-700">{errors.agreePrivacy}</span>}
      </div>

      {formError && (
        <p role="alert" className="mt-5 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{formError}</p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="mt-6 w-full rounded-xl bg-court px-6 py-4 text-lg font-bold text-white disabled:opacity-60"
      >
        {submitting ? "Holding your slot…" : `Hold my slot and pay ${formatPeso(quote.reservationFeeCentavos)}`}
      </button>
      <p className="mt-3 text-center text-sm text-muted">Your slot is held while you pay with GCash on the next page.</p>
    </form>
  );
}
