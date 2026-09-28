-- Adds a per-employee overtime toggle. Additive, defaulted to true so every existing employee keeps
-- exactly the automatic-overtime behavior they already had.

-- AlterTable
ALTER TABLE `Employee` ADD COLUMN `overtimeEligible` BOOLEAN NOT NULL DEFAULT true;
