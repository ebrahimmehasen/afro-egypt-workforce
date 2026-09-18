-- Backfilled by scripts/backfill-employee-numbers.ts before this ran (every
-- existing Employee row now has employeeNumber set) - safe to lock down.
ALTER TABLE `Employee` MODIFY COLUMN `employeeNumber` VARCHAR(191) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Employee_employeeNumber_key` ON `Employee`(`employeeNumber`);
