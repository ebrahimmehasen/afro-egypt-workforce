-- Employee archiving: nothing is removed. Two nullable columns are added and the
-- existing terminated employees get an estimated termination date.

-- AlterTable
ALTER TABLE `Employee` ADD COLUMN `terminatedAt` DATETIME(3) NULL,
    ADD COLUMN `archivedAt` DATETIME(3) NULL;

-- The real termination date was never recorded, so `updatedAt` (the last time the row was
-- touched, which for a terminated employee is normally when they were terminated) stands in.
-- It can only be later than the true date, so nobody is archived earlier than they should be.
UPDATE `Employee` SET `terminatedAt` = `updatedAt` WHERE `status` = 'terminated' AND `terminatedAt` IS NULL;
