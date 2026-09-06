-- AlterTable
ALTER TABLE `employee` ADD COLUMN `dailyRate` INTEGER NULL,
    ADD COLUMN `dailyWorkingHours` DOUBLE NOT NULL DEFAULT 8,
    ADD COLUMN `salaryType` ENUM('monthly', 'daily') NOT NULL DEFAULT 'monthly';

-- AlterTable
ALTER TABLE `payrollrecord` ADD COLUMN `dailyRateApplied` INTEGER NULL,
    ADD COLUMN `paidDaysCount` INTEGER NULL;
