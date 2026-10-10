"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  referenceCode: string;
  token: string;
  amountLabel: string; // "₱225.00"
  amountPlain: string; // "225.00"
  mode: "GCASH_MANUAL" | "GCASH_PAYMONGO";
  gcash: { name: string; number: string; qrImagePath: string | null };
  afterExpiry?: boolean; // hold ran out, but the customer may have already paid
};

/** Shrinks big phone screenshots before upload — faster on mobile data. */
async function compressImage(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 1.5 * 1024 * 1024 && /image\/(png|jpeg|webp)/.test(file.type)) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    return blob ?? file;
  } catch {
    return file; // the server will say if the format isn't supported
  }
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="rounded-lg border border-line px-3 py-1 text-sm font-bold text-court"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard blocked: the text is still visible to copy by hand */
        }
      }}
      aria-label={`Copy ${label}`}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

export default function PaymentBox(props: Props) {
  return props.mode === "GCASH_PAYMONGO" ? <PayMongoButton {...props} /> : <ManualGcash {...props} />;
}

function PayMongoButton(props: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/bookings/${props.referenceCode}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: props.token }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      window.location.href = json.url;
    } catch (e) {
      setError((e as Error).message || "GCash checkout is unavailable right now.");
      setBusy(false);
    }
  };
  return (
    <section className="mt-4 rounded-2xl border border-line bg-white p-5">
      <h2 className="font-display text-xl font-semibold">Pay with GCash</h2>
      <p className="mt-1 text-muted">You’ll be taken to GCash to pay {props.amountLabel}, then brought back here.</p>
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      <button type="button" onClick={go} disabled={busy}
        className="mt-4 w-full rounded-xl bg-pool px-6 py-4 text-lg font-bold text-white disabled:opacity-60">
        {busy ? "Opening GCash…" : `Pay ${props.amountLabel} with GCash`}
      </button>
    </section>
  );
}

function ManualGcash(props: Props) {
  const router = useRouter();
  const [gcashReference, setRef] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notSetUp = props.gcash.number.includes("[");

  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^\d{10,16}$/.test(gcashReference.replace(/[\s-]/g, ""))) return setError("Enter the Ref. No. from your GCash receipt (numbers only).");
    if (!file) return setError("Please attach your GCash receipt screenshot.");
    setBusy(true);
    try {
      const body = new FormData();
      body.set("token", props.token);
      body.set("gcashReference", gcashReference);
      body.set("screenshot", await compressImage(file), "receipt.jpg");
      const res = await fetch(`/api/bookings/${props.referenceCode}/proof`, { method: "POST", body });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      router.refresh();
    } catch (err) {
      setError((err as Error).message || "We couldn't send your proof. Please try again.");
      setBusy(false);
    }
  };

  const step = "font-display text-lg font-semibold";
  return (
    <form onSubmit={submit} className="mt-4 rounded-2xl border border-line bg-white p-5">
      <h2 className="font-display text-xl font-semibold">
        {props.afterExpiry ? "Already sent your GCash payment?" : "Pay with GCash"}
      </h2>
      {props.afterExpiry && (
        <p className="mt-1 text-muted">Send us your proof. If your slot is still free, we’ll put your booking back.</p>
      )}

      <ol className="mt-4 grid gap-6">
        {!props.afterExpiry && (
          <li>
            <p className={step}>1. Send exactly {props.amountLabel}</p>
            {notSetUp && <p className="mt-2 text-sm text-red-700">GCash account details haven’t been set up yet.</p>}
            {props.gcash.qrImagePath && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={props.gcash.qrImagePath} alt="GCash QR code" className="mt-3 w-56 rounded-xl border border-line" />
            )}
            <dl className="mt-3 grid gap-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">Account name</dt>
                <dd className="font-bold">{props.gcash.name}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">GCash number</dt>
                <dd className="flex items-center gap-2 font-bold">
                  {props.gcash.number} <CopyButton text={props.gcash.number.replace(/\s/g, "")} label="GCash number" />
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">Amount</dt>
                <dd className="flex items-center gap-2 font-bold">
                  {props.amountLabel} <CopyButton text={props.amountPlain} label="amount" />
                </dd>
              </div>
            </dl>
          </li>
        )}
        <li>
          <label className="block">
            <span className={step}>{props.afterExpiry ? "1." : "2."} Enter the Ref. No. from your receipt</span>
            <input
              className="mt-2 block w-full rounded-xl border border-line px-4 py-3 text-lg tracking-wider"
              inputMode="numeric" autoComplete="off" placeholder="1234 567 890123"
              value={gcashReference} onChange={(e) => setRef(e.target.value)}
            />
          </label>
        </li>
        <li>
          <label className="block">
            <span className={step}>{props.afterExpiry ? "2." : "3."} Attach the receipt screenshot</span>
            <input type="file" accept="image/*" className="mt-2 block w-full text-sm"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          {preview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Your receipt screenshot" className="mt-3 max-h-64 rounded-xl border border-line" />
          )}
        </li>
      </ol>

      {error && <p role="alert" className="mt-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}

      <button type="submit" disabled={busy}
        className="mt-6 w-full rounded-xl bg-court px-6 py-4 text-lg font-bold text-white disabled:opacity-60">
        {busy ? "Sending…" : "Send payment proof"}
      </button>
      <p className="mt-3 text-center text-sm text-muted">Staff check every payment. You’ll get an email once it’s confirmed.</p>
    </form>
  );
}
