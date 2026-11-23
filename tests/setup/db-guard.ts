// Runs before every test file (vitest.config.ts → setupFiles). Decides which database the run may touch and puts
// it in DATABASE_URL before any test builds a Prisma client — whatever the shell or .env holds is replaced.
import fs from "node:fs";
import path from "node:path";
import { chooseTestDatabase, databaseUrlFromEnvFile } from "./test-database";

const shellUrl = process.env.DATABASE_URL;
let envFileUrl: string | undefined;
try {
  envFileUrl = databaseUrlFromEnvFile(fs.readFileSync(path.join(process.cwd(), ".env"), "utf8"));
} catch {
  envFileUrl = undefined;
}

const choice = chooseTestDatabase({ testUrl: process.env.TEST_DATABASE_URL, productionUrls: [shellUrl, envFileUrl] });
process.env.DATABASE_URL = choice.url;

if (choice.problem) {
  // fail loudly: every test file stops here, so nothing runs against a database it should not
  throw new Error(`Refusing to run the tests: ${choice.problem}`);
}
if (!choice.enabled && !(globalThis as { __testDbWarned?: boolean }).__testDbWarned) {
  (globalThis as { __testDbWarned?: boolean }).__testDbWarned = true;
  console.warn("[tests] TEST_DATABASE_URL is not set: the database integration tests are skipped (they never use DATABASE_URL).");
}
