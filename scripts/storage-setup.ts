// One-time: creates the private "payment-proofs" bucket in Supabase Storage.
import { ensureProofBucket } from "../src/lib/storage";

ensureProofBucket()
  .then((r) => console.log(r === "created" ? "Private bucket created." : "Bucket already exists. Nothing to do."))
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
