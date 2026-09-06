-- AlterTable
ALTER TABLE `Employee` ADD COLUMN `address` TEXT NULL,
    ADD COLUMN `militaryStatus` ENUM('completed', 'exempted', 'postponed', 'not_applicable') NULL,
    ADD COLUMN `nationalId` VARCHAR(191) NULL,
    ADD COLUMN `qualification` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Employee_nationalId_key` ON `Employee`(`nationalId`);
