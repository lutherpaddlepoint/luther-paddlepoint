// PayMongo checkout (GCash). Used when the payment mode is switched to GCASH_PAYMONGO.
const API = "https://api.paymongo.com/v1";

const auth = () => {
  const key = process.env.PAYMONGO_SECRET_KEY;
  if (!key) throw new Error("PAYMONGO_SECRET_KEY is not set.");
  return "Basic " + Buffer.from(`${key}:`).toString("base64");
};

export async function createGcashCheckout(args: {
  referenceCode: string;
  description: string;
  amountCentavos: number;
  successUrl: string;
  cancelUrl: string;
  customer: { name?: string | null; email?: string | null; phone?: string | null };
}): Promise<{ id: string; checkoutUrl: string }> {
  const res = await fetch(`${API}/checkout_sessions`, {
    method: "POST",
    headers: { Authorization: auth(), "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      data: {
        attributes: {
          line_items: [
            { name: `Reservation fee ${args.referenceCode}`, description: args.description, amount: args.amountCentavos, currency: "PHP", quantity: 1 },
          ],
          payment_method_types: ["gcash"],
          reference_number: args.referenceCode,
          description: args.description,
          success_url: args.successUrl,
          cancel_url: args.cancelUrl,
          send_email_receipt: false,
          show_description: true,
          show_line_items: true,
          billing: {
            name: args.customer.name ?? undefined,
            email: args.customer.email ?? undefined,
            phone: args.customer.phone ?? undefined,
          },
          metadata: { reference_code: args.referenceCode },
        },
      },
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`PayMongo checkout failed (${res.status}): ${JSON.stringify(json?.errors ?? json)}`);
  return { id: json.data.id, checkoutUrl: json.data.attributes.checkout_url };
}

/** One-time setup: register the webhook URL and get its secret. */
export async function registerWebhook(url: string) {
  const res = await fetch(`${API}/webhooks`, {
    method: "POST",
    headers: { Authorization: auth(), "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ data: { attributes: { url, events: ["checkout_session.payment.paid"] } } }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Webhook registration failed (${res.status}): ${JSON.stringify(json?.errors ?? json)}`);
  return { id: json.data.id as string, secret: json.data.attributes.secret_key as string };
}
