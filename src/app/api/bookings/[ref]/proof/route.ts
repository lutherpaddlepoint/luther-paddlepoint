import { NextResponse } from "next/server";
import { submitManualProof, PaymentError } from "@/lib/payments";
import { MAX_PROOF_BYTES } from "@/lib/payment-core";
import { getSettings } from "@/lib/settings";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { ref: string } }) {
  if (!rateLimit(`proof:${clientIp(req)}`, 10, 10 * 60_000))
    return NextResponse.json({ error: "Too many attempts. Please wait a few minutes." }, { status: 429 });

  const settings = await getSettings();
  if (settings.payment_mode !== "GCASH_MANUAL")
    return NextResponse.json({ error: "Please use the GCash checkout button instead." }, { status: 400 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "The upload didn't come through. Please try again." }, { status: 400 });
  }
  const token = String(form.get("token") ?? "");
  const gcashReference = String(form.get("gcashReference") ?? "");
  const file = form.get("screenshot");
  if (!(file instanceof Blob)) return NextResponse.json({ error: "Please attach your GCash receipt screenshot." }, { status: 422 });
  if (file.size > MAX_PROOF_BYTES)
    return NextResponse.json({ error: "The screenshot is too large. Please use a smaller image." }, { status: 413 });

  try {
    const result = await submitManualProof({
      referenceCode: params.ref,
      token,
      gcashReference,
      image: new Uint8Array(await file.arrayBuffer()),
    });
    return NextResponse.json({ result });
  } catch (e) {
    if (e instanceof PaymentError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("Proof upload failed", e);
    return NextResponse.json({ error: "We couldn't save your proof. Please try again." }, { status: 500 });
  }
}
