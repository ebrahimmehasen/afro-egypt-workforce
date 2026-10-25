import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The integration tests share one database. payroll-recalc runs a real payroll calculation, which covers every
// active employee on file — including the temporary employees other test files create and delete. Run side by
// side, either side can trip over the other's rows (a payroll record for an employee being deleted, or an
// employee that can't be deleted because a payroll record now points at it). So it runs alone, in a group of
// its own after every other file has finished; the rest stay parallel.
const SERIAL_AFTER_ALL = ["tests/payroll-recalc.test.ts"];

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
        test: { name: "default", environment: "node", include: ["tests/**/*.test.ts"], exclude: SERIAL_AFTER_ALL },
      },
      {
        ...shared,
        test: { name: "payroll-db", environment: "node", include: SERIAL_AFTER_ALL, sequence: { groupOrder: 1 } },
      },
    ],
  },
});
