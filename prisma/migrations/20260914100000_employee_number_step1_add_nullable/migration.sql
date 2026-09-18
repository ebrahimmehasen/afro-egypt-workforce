-- CreateTable
CREATE TABLE `DepartmentNumberSequence` (
    `code` VARCHAR(191) NOT NULL,
    `lastValue` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable: nullable for now, backfilled by scripts/backfill-employee-numbers.ts,
-- then locked down to NOT NULL + UNIQUE in the next migration.
ALTER TABLE `Employee` ADD COLUMN `employeeNumber` VARCHAR(191) NULL;
