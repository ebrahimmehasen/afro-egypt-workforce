import { PrismaClient } from "@prisma/client";
import { notifyDataChanged } from "@/lib/events";

const MUTATING_OPERATIONS = new Set([
  "create", "createMany", "createManyAndReturn",
  "update", "updateMany", "updateManyAndReturn",
  "upsert", "delete", "deleteMany",
]);

/**
 * Wraps every model operation (including ones run inside `$transaction`) so
 * any write anywhere in the app — a server action, the /api/punch device
 * endpoint, a background recalculation — broadcasts a single "something
 * changed" signal (see src/lib/events.ts + src/app/api/events/route.ts),
 * which live-refreshes every open page via src/components/shared/live-refresh.tsx.
 * A write inside a transaction that later rolls back still fires this signal
 * (fired per-statement, not after commit) — acceptable for a "nice to have"
 * refresh hint, not something correctness depends on.
 */
function createClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  }).$extends({
    query: {
      $allModels: {
        async $allOperations({ operation, args, query }) {
          const result = await query(args);
          if (MUTATING_OPERATIONS.has(operation)) notifyDataChanged();
          return result;
        },
      },
    },
  });
}

type ExtendedPrismaClient = ReturnType<typeof createClient>;

/**
 * `Prisma.TransactionClient` (the type Prisma generates for a `$transaction`
 * callback) doesn't structurally match an *extended* client's transaction
 * callback — derive the real type from `prisma` itself instead. Use this
 * everywhere a function takes a transaction handle (e.g. audit.ts).
 */
export type TransactionClient = Parameters<Parameters<ExtendedPrismaClient["$transaction"]>[0]>[0];

// Reuse one PrismaClient across Next.js dev-server hot reloads.
const globalForPrisma = globalThis as unknown as { prisma?: ExtendedPrismaClient };

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
