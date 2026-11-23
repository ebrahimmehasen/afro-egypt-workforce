// Which database the integration tests may use. Pure, so the rule itself is tested (tests/test-database-guard.test.ts).
//
// The tests that need a database create, change and delete rows (payroll runs, temporary employees, audit rows,
// punches), so they must never see the production database. They get a database only from TEST_DATABASE_URL, and
// only when it is clearly a separate one: its name must contain "test" and it must not be the database any
// production URL names. Without TEST_DATABASE_URL they are given a dead address, so they skip (as they do when
// there is no database at all) instead of silently using whatever DATABASE_URL happens to hold.

/** An address nothing listens on: the integration tests see "database unreachable" and skip. */
export const DISABLED_DATABASE_URL = "mysql://tests-disabled:tests-disabled@127.0.0.1:1/tests_disabled";

export interface TestDatabaseChoice {
  /** The URL to put in DATABASE_URL for the test run. */
  url: string;
  /** True when a real, separate test database is in use. */
  enabled: boolean;
  /** Why the run must stop, when the configured test database is not acceptable. */
  problem?: string;
}

function target(url: string): { host: string; port: string; database: string } | null {
  try {
    const u = new URL(url);
    return { host: u.hostname.toLowerCase(), port: u.port || "3306", database: decodeURIComponent(u.pathname.replace(/^\//, "")).toLowerCase() };
  } catch {
    return null;
  }
}

export function chooseTestDatabase(input: { testUrl: string | undefined; productionUrls: Array<string | undefined> }): TestDatabaseChoice {
  const testUrl = input.testUrl?.trim();
  if (!testUrl) return { url: DISABLED_DATABASE_URL, enabled: false };

  const test = target(testUrl);
  if (!test || !test.database) return { url: DISABLED_DATABASE_URL, enabled: false, problem: "TEST_DATABASE_URL is not a database URL with a database name." };
  if (!test.database.includes("test")) {
    return { url: DISABLED_DATABASE_URL, enabled: false, problem: `TEST_DATABASE_URL names the database "${test.database}": a test database's name must contain "test".` };
  }
  for (const production of input.productionUrls) {
    const p = production ? target(production.trim()) : null;
    if (p && p.host === test.host && p.port === test.port && p.database === test.database) {
      return { url: DISABLED_DATABASE_URL, enabled: false, problem: "TEST_DATABASE_URL points at the same database as a production URL." };
    }
  }
  return { url: testUrl, enabled: true };
}

/** DATABASE_URL as written in a dotenv file's text (BOM, quotes and comments tolerated). */
export function databaseUrlFromEnvFile(text: string): string | undefined {
  const line = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .find((l) => /^\s*DATABASE_URL\s*=/.test(l));
  if (!line) return undefined;
  return line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
}
