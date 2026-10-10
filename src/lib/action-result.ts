export type ActionResult =
  | { ok: true; message?: string; redirect?: string; secret?: string }
  | { ok: false; error: string };
