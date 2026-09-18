-- AlterTable: nullable, so an employee can exist unlinked from any device user.
ALTER TABLE `Employee` MODIFY COLUMN `biometricDeviceUserId` VARCHAR(191) NULL;

-- CreateIndex: one device user can never be linked to more than one employee.
-- MySQL allows multiple NULLs through a UNIQUE index, so unlinked employees
-- don't conflict with each other.
CREATE UNIQUE INDEX `Employee_biometricDeviceUserId_key` ON `Employee`(`biometricDeviceUserId`);
