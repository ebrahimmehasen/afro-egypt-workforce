import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The integration tests share one database. payroll-recalc runs a real payroll calculation, which covers every
// active employee on file — including the temporary employees other test files create and delete. Run side by
// side, either side can trip over the other's rows (a payroll record for an employee being deleted, or an
// employee that can't be deleted because a payroll record now points at it). So it runs alone, in a group of
// its own after every other file has finished; the rest stay parallel.
const SERIAL_AFTER_ALL = ["tests/payroll-recalc.test.ts"];
// punch-quarantine posts deductions and overtime for temporary employees (the job covers every employee), which the
// department report and the payroll run would also count: it runs alone too, after payroll-recalc.
const SERIAL_LAST = ["tests/punch-quarantine.test.ts"];
// exit-classification snapshots every pay row of a month, so nothing else may write pay rows while it runs: last of all.
const SERIAL_FINAL = ["tests/exit-classification.test.ts"];

// Every test file first decides which database it may touch: only a separate TEST_DATABASE_URL, never the
// production one (tests/setup/db-guard.ts).
const DB_GUARD = ["./tests/setup/db-guard.ts"];

const shared = {
  // Match Next's automatic JSX runtime so components render without importing React.
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
};

export default defineConfig({
  ...shared,
  test: {
    projects: [
      {
        ...shared,
        test: { name: "default", environment: "node", include: ["tests/**/*.test.{ts,tsx}"], exclude: [...SERIAL_AFTER_ALL, ...SERIAL_LAST, ...SERIAL_FINAL], setupFiles: DB_GUARD },
      },
      {
        ...shared,
        test: { name: "payroll-db", environment: "node", include: SERIAL_AFTER_ALL, sequence: { groupOrder: 1 }, setupFiles: DB_GUARD },
      },
      {
        ...shared,
        test: { name: "quarantine-db", environment: "node", include: SERIAL_LAST, sequence: { groupOrder: 2 }, setupFiles: DB_GUARD },
      },
      {
        ...shared,
        test: { name: "exit-classification-db", environment: "node", include: SERIAL_FINAL, sequence: { groupOrder: 3 }, setupFiles: DB_GUARD },
      },
    ],
  },
});
