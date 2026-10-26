-- Timed permissions: a permission can now carry the time the employee leaves and for how long, and the minutes
-- past a temporary permission are charged by their own pay-type multiplier as their own deduction type.
-- All additive: the new Leave columns are nullable (older permissions keep working as a permission for the
-- rest of the day), the multiplier is defaulted to 2 on every pay type, and the enum only gains a value.

-- AlterTable
ALTER TABLE `PayType` ADD COLUMN `permissionOverrunMultiplier` DOUBLE NOT NULL DEFAULT 2;

-- AlterTable
ALTER TABLE `Leave` ADD COLUMN `startTime` VARCHAR(191) NULL,
    ADD COLUMN `durationMinutes` INTEGER NULL;

-- AlterTable
ALTER TABLE `Deduction` MODIFY `type` ENUM('late', 'absence', 'early_leave', 'permission', 'unauthorized_exit', 'penalty', 'advance', 'admin_deduction', 'other', 'permission_overrun') NOT NULL;
