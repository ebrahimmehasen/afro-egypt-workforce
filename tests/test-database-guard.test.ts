import { describe, expect, it } from "vitest";
import { DISABLED_DATABASE_URL, chooseTestDatabase, databaseUrlFromEnvFile } from "./setup/test-database";

/**
 * The database integration tests create and delete rows, so they may only run against a separate test database
 * named in TEST_DATABASE_URL — never against whatever DATABASE_URL (or .env) holds.
 */
const PROD = "mysql://afro:secret@127.0.0.1:3306/afro_egypt_workforce";
const TEST = "mysql://afro:secret@127.0.0.1:3306/afro_egypt_test_scratch";

describe("which database the tests may use", () => {
  it("without TEST_DATABASE_URL they get a dead address, not DATABASE_URL, so they skip", () => {
    for (const testUrl of [undefined, "", "   "]) {
      expect(chooseTestDatabase({ testUrl, productionUrls: [PROD] })).toEqual({ url: DISABLED_DATABASE_URL, enabled: false });
    }
    expect(DISABLED_DATABASE_URL).not.toContain("afro");
  });

  it("a separate test database is used as given", () => {
    expect(chooseTestDatabase({ testUrl: TEST, productionUrls: [PROD, undefined] })).toEqual({ url: TEST, enabled: true });
  });

  it("stops the run when the test URL is the production database", () => {
    const r = chooseTestDatabase({ testUrl: PROD, productionUrls: [PROD] });
    expect(r.enabled).toBe(false);
    expect(r.url).toBe(DISABLED_DATABASE_URL);
    expect(r.problem).toBeTruthy();
  });

  it("stops the run when the database name does not say it is a test database, even for another URL", () => {
    expect(chooseTestDatabase({ testUrl: "mysql://a:b@db.example:3306/payroll", productionUrls: [] }).problem).toMatch(/contain "test"/);
  });

  it("stops the run on the same database written differently, or on one that is not a URL", () => {
    expect(chooseTestDatabase({ testUrl: "mysql://x:y@127.0.0.1/Afro_Test", productionUrls: ["mysql://u:p@127.0.0.1:3306/afro_test"] }).problem).toMatch(/same database/);
    expect(chooseTestDatabase({ testUrl: "not a url", productionUrls: [] }).problem).toBeTruthy();
    expect(chooseTestDatabase({ testUrl: "mysql://u:p@127.0.0.1:3306/", productionUrls: [] }).problem).toBeTruthy();
  });

  it("reads DATABASE_URL out of a dotenv file, with a BOM, quotes or CRLF", () => {
    expect(databaseUrlFromEnvFile(`﻿DATABASE_URL="${PROD}"\r\nSESSION_SECRET=x\r\n`)).toBe(PROD);
    expect(databaseUrlFromEnvFile(`# c\nOTHER=1\nDATABASE_URL=${PROD}\n`)).toBe(PROD);
    expect(databaseUrlFromEnvFile("SESSION_SECRET=x")).toBeUndefined();
  });
});
