/**
 * One-off recovery for the failed 2026-09-18 deploy, run by the deploy workflow
 * right before `prisma migrate deploy`. It does nothing unless migration
 * 20260917091223_change_requests_and_multi_department_scope is currently
 * recorded as FAILED in _prisma_migrations, so it is a no-op on every healthy
 * database (including dev and CI).
 *
 * What went wrong: on MariaDB (the live DB) `ADD COLUMN permissions JSON NOT
 * NULL` fills existing rows with '' (invalid JSON) and the column's json_valid
 * CHECK then rejects every later UPDATE on those rows, so the next migration's
 * backfill failed after already adding `departmentIds`. To recover we (1) give
 * every account a valid permissions list (each role's pre-permissions page
 * access), (2) drop the half-added departmentIds column, and (3) mark the
 * migration rolled back so `migrate deploy` re-runs it cleanly.
 */
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const NAME = "20260917091223_change_requests_and_multi_department_scope";
const prisma = new PrismaClient();

const HR = ["employees", "departments", "shifts", "attendance", "leaves", "overtime", "deductions", "payroll", "reports", "workforce_cost", "audit_log"];
const SUPERVISOR = ["employees", "attendance", "leaves", "overtime", "reports"];
const arr = (a) => JSON.stringify(a);

try {
  const failed = await prisma.$queryRawUnsafe(
    "SELECT migration_name FROM _prisma_migrations WHERE migration_name = ? AND finished_at IS NULL AND rolled_back_at IS NULL",
    NAME,
  );
  if (failed.length === 0) {
    console.log("repair: migration is not in a failed state - nothing to do.");
  } else {
    console.log("repair: found failed migration, repairing...");
    const broken = "NOT JSON_VALID(`permissions`) OR `permissions` IS NULL OR JSON_TYPE(`permissions`) = 'NULL'";
    await prisma.$executeRawUnsafe(`UPDATE \`user\` SET \`permissions\` = ? WHERE \`role\` = 'hr' AND (${broken})`, arr(HR));
    await prisma.$executeRawUnsafe(`UPDATE \`user\` SET \`permissions\` = ? WHERE \`role\` = 'supervisor' AND (${broken})`, arr(SUPERVISOR));
    await prisma.$executeRawUnsafe(`UPDATE \`user\` SET \`permissions\` = '[]' WHERE ${broken}`);

    const col = await prisma.$queryRawUnsafe(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user' AND COLUMN_NAME = 'departmentIds'",
    );
    if (col.length > 0) {
      await prisma.$executeRawUnsafe("ALTER TABLE `user` DROP COLUMN `departmentIds`");
      console.log("repair: dropped half-added departmentIds column.");
    }
    execSync(`npx prisma migrate resolve --rolled-back ${NAME}`, { stdio: "inherit" });
    console.log("repair: done.");
  }
} finally {
  await prisma.$disconnect();
}
