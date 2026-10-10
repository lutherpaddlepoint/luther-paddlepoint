// Appends prisma/sql/constraints.sql to the newest migration created with --create-only.
// Safe to run twice: it skips if the constraints are already there.
import { readdirSync, readFileSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const migrationsDir = "prisma/migrations";
const marker = "bookings_no_overlap";

const folders = existsSync(migrationsDir)
  ? readdirSync(migrationsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
  : [];

if (folders.length === 0) {
  console.error("No migration found. Run `npm run db:create-init` first.");
  process.exit(1);
}

const target = join(migrationsDir, folders[folders.length - 1], "migration.sql");

if (readFileSync(target, "utf8").includes(marker)) {
  console.log(`Constraints already present in ${target}. Nothing to do.`);
} else {
  appendFileSync(target, "\n" + readFileSync("prisma/sql/constraints.sql", "utf8"));
  console.log(`Appended constraints to ${target}. Now run: npm run db:migrate`);
}
