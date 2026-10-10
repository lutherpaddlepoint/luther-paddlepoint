// Private file storage for GCash screenshots (Supabase Storage, via its REST API).
// Files are never public: staff view them through short-lived signed links.

const env = () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.PROOF_BUCKET || "payment-proofs";
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  return { url: url.replace(/\/$/, ""), key, bucket };
};

const headers = (key: string) => ({ Authorization: `Bearer ${key}`, apikey: key });

export async function uploadProof(path: string, bytes: Uint8Array, contentType: string) {
  const { url, key, bucket } = env();
  const res = await fetch(`${url}/storage/v1/object/${bucket}/${path}`, {
    method: "POST",
    headers: { ...headers(key), "Content-Type": contentType, "x-upsert": "false", "Cache-Control": "private, max-age=0" },
    body: Buffer.from(bytes),
  });
  if (!res.ok) throw new Error(`Upload failed (${res.status}): ${await res.text()}`);
}

export async function deleteProof(path: string) {
  const { url, key, bucket } = env();
  await fetch(`${url}/storage/v1/object/${bucket}`, {
    method: "DELETE",
    headers: { ...headers(key), "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: [path] }),
  }).catch(() => undefined);
}

/** A link that works for a few minutes, for staff to view a screenshot. */
export async function signedProofUrl(path: string, expiresInSeconds = 300): Promise<string> {
  const { url, key, bucket } = env();
  const res = await fetch(`${url}/storage/v1/object/sign/${bucket}/${path}`, {
    method: "POST",
    headers: { ...headers(key), "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: expiresInSeconds }),
  });
  if (!res.ok) throw new Error(`Could not create link (${res.status})`);
  const json = (await res.json()) as { signedURL?: string; signedUrl?: string };
  return `${url}/storage/v1${json.signedURL ?? json.signedUrl}`;
}

/** One-time setup: creates the private bucket if it doesn't exist. */
export async function ensureProofBucket() {
  const { url, key, bucket } = env();
  const res = await fetch(`${url}/storage/v1/bucket`, {
    method: "POST",
    headers: { ...headers(key), "Content-Type": "application/json" },
    body: JSON.stringify({
      id: bucket, name: bucket, public: false,
      file_size_limit: 4 * 1024 * 1024,
      allowed_mime_types: ["image/jpeg", "image/png", "image/webp"],
    }),
  });
  if (res.ok) return "created";
  const text = await res.text();
  if (res.status === 409 || /already exists/i.test(text)) return "exists";
  throw new Error(`Bucket setup failed (${res.status}): ${text}`);
}
