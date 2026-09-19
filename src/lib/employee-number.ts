import { TransactionClient } from "@/lib/prisma";
import { departmentCode } from "@/lib/department-codes";

/**
 * Atomically claims the next sequence value for a department code and returns
 * "<CODE>-<seq>" (e.g. "ACC-001"). Uses MySQL's `INSERT ... ON DUPLICATE KEY
 * UPDATE col = LAST_INSERT_ID(expr)` idiom: the whole read-increment-write is
 * one atomic statement server-side, so concurrent inserts for the same
 * department can never claim the same number — no app-level locking needed.
 *
 * Must run inside the same transaction as the Employee.create it backs, via
 * `tx` (see createEmployee in src/lib/actions/employees.ts), so a rolled-back
 * create doesn't leave a gap-causing side effect... actually a gap is fine
 * (sequences are allowed to skip), what matters is no two employees ever get
 * the same number, which this guarantees regardless of transaction outcome.
 */
export async function generateEmployeeNumber(tx: TransactionClient, departmentName: string): Promise<string> {
  const code = departmentCode(departmentName);

  await tx.$executeRaw`
    INSERT INTO DepartmentNumberSequence (code, lastValue)
    VALUES (${code}, LAST_INSERT_ID(1))
    ON DUPLICATE KEY UPDATE lastValue = LAST_INSERT_ID(lastValue + 1)
  `;
  const rows = await tx.$queryRaw<{ seq: bigint }[]>`SELECT LAST_INSERT_ID() AS seq`;
  const seq = Number(rows[0].seq);

  return `${code}-${String(seq).padStart(3, "0")}`;
}
