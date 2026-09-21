-- The company's internal bylaws (اللائحة الداخلية).

-- System deductions posted from attendance: one per employee, day and kind, kept in step with the day
-- unless someone edits or removes it.
ALTER TABLE `Deduction`
    ADD COLUMN `systemKey` VARCHAR(191) NULL,
    ADD COLUMN `editedBy` VARCHAR(191) NULL,
    ADD COLUMN `editedAt` DATETIME(3) NULL,
    ADD COLUMN `voidedBy` VARCHAR(191) NULL,
    ADD COLUMN `voidedAt` DATETIME(3) NULL;
CREATE UNIQUE INDEX `Deduction_systemKey_key` ON `Deduction`(`systemKey`);

-- Work runs 08:00 to 18:00 (ten hours, the 12:00-12:30 break inside it), with no grace period.
UPDATE `Shift` SET `endTime` = '18:00' WHERE `startTime` = '08:00' AND `endTime` = '16:00' AND `deletedAt` IS NULL;
UPDATE `Shift` SET `gracePeriodMinutes` = 0;
UPDATE `AttendanceSettings` SET `defaultGracePeriodMinutes` = 0;
UPDATE `PayrollSettings` SET `workingHoursPerDay` = 10, `overtimeHourlyMultiplier` = 1.5;
UPDATE `Employee` SET `dailyWorkingHours` = 10;
