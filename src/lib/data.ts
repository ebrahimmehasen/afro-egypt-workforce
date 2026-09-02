import { ensureSeeded } from "@/lib/seed";
import { db } from "@/lib/store";

/** Always use this instead of importing `db` directly — guarantees demo data is seeded. */
export function getDb() {
  ensureSeeded();
  return db;
}
