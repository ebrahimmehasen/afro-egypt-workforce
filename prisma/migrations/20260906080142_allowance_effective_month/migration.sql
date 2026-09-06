-- AlterTable
ALTER TABLE `allowance` ADD COLUMN `effectiveMonth` INTEGER NULL,
    ADD COLUMN `effectiveYear` INTEGER NULL;

-- CreateIndex
CREATE INDEX `Allowance_effectiveYear_effectiveMonth_idx` ON `Allowance`(`effectiveYear`, `effectiveMonth`);
