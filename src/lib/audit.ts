import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { getT } from "@/lib/i18n";

/**
 * The audit-log chokepoint. Spec §46 requires every state change to be
 * attributable ("who did what, when, in which module"). Instead of a bare
 * `prisma` write followed by an easy-to-forget `addAuditLog` call, mutations go
 * through `recordChange`, which writes the change and its audit row in ONE
 * transaction — they land together or not at all — and resolves the acting user
 * once, here, rather than re-typing `user?.name ?? system` at every call site.
 */
export interface AuditEntry {
  /** Localized module name, e.g. `t.nav.employees`. */
  module: string;
  /** Localized action label, e.g. `t.auditActions.addEmployee`. */
  action: string;
  oldValue?: string;
  newValue?: string;
  reason?: string;
}

/** The acting user's display name — their session name, or the localized "System". */
export async function auditActor(): Promise<string> {
  const [user, t] = await Promise.all([getSession(), getT()]);
  return user?.name ?? t.auditActions.system;
}

function auditData(entry: AuditEntry, userName: string): Prisma.AuditLogEntryCreateInput {
  return {
    userName,
    action: entry.action,
    module: entry.module,
    oldValue: entry.oldValue ?? "-",
    newValue: entry.newValue ?? "-",
    reason: entry.reason ?? null,
  };
}

/**
 * Runs `write` and appends its audit row as a single transaction, attributed to
 * an explicit actor. `recordChange` is the request-time wrapper over this;
 * tests and jobs that have no session call this directly.
 */
export async function recordChangeAs<T>(
  userName: string,
  entry: AuditEntry,
  write: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const result = await write(tx);
    await tx.auditLogEntry.create({ data: auditData(entry, userName) });
    return result;
  });
}

/**
 * Runs `write` and appends its audit row as a single transaction. Use this for
 * any state change that must be audited.
 */
export async function recordChange<T>(
  entry: AuditEntry,
  write: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return recordChangeAs(await auditActor(), entry, write);
}

/**
 * Append an audit row inside a transaction the caller already owns (e.g.
 * `calculatePayroll`, which wraps many writes). Resolve `userName` with
 * `auditActor()` *before* opening the transaction.
 */
export async function writeAudit(
  tx: Prisma.TransactionClient,
  entry: AuditEntry,
  userName: string,
): Promise<void> {
  await tx.auditLogEntry.create({ data: auditData(entry, userName) });
}
