import { prisma } from "./db";
import { DEFAULT_SETTINGS, type AppSettings } from "./defaults";

/** Settings from the database, falling back to defaults for anything missing. */
export async function getSettings(): Promise<AppSettings> {
  const rows = await prisma.setting.findMany();
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    if (row.key.startsWith("referee_token") || row.key.startsWith("court_timer")) continue; // not general settings (secrets / live state)
    merged[row.key] = row.value;
  }
  return merged as AppSettings;
}
