// Supabase gives every project a public "Data API". This app never uses it (it talks to the
// database directly), so this script closes it off: no table can be read or changed, and the
// booking functions can't be called, through that API. Safe to run again; run it after every
// new migration.
//   npm run db:lockdown
import { prisma } from "../src/lib/db";

async function main() {
  await prisma.$executeRawUnsafe(`
DO $$
DECLARE r record;
BEGIN
  -- Row Level Security on with no policies = the Data API sees nothing.
  -- The app connects as the table owner, which is not affected.
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
  END LOOP;

  -- The functions must not be callable from outside (reserve_pool_spots could fill the pool).
  REVOKE EXECUTE ON FUNCTION public.expire_stale_holds() FROM PUBLIC;
  REVOKE EXECUTE ON FUNCTION public.reserve_pool_spots(uuid, integer) FROM PUBLIC;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
    REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
  END IF;
END $$;`);

  const open = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity`;
  if (open.length) throw new Error(`Still open: ${open.map((t) => t.tablename).join(", ")}`);
  console.log("Locked down: all tables protected, booking functions not callable from outside.");
}

main()
  .catch((e) => {
    console.error(e.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
