-- Reshape EmployeeAcknowledgment: signed-PDF/generate flow -> fixed + custom upload slots.
DROP INDEX `EmployeeAcknowledgment_type_idx` ON `EmployeeAcknowledgment`;

ALTER TABLE `EmployeeAcknowledgment` DROP COLUMN `createdBy`,
    DROP COLUMN `generatedAt`,
    DROP COLUMN `signedAt`,
    DROP COLUMN `title`,
    DROP COLUMN `type`,
    ADD COLUMN `key` VARCHAR(191) NOT NULL,
    ADD COLUMN `label` VARCHAR(191) NOT NULL,
    ADD COLUMN `mimeType` VARCHAR(191) NULL,
    ADD COLUMN `uploadedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `uploadedBy` VARCHAR(191) NULL,
    MODIFY `fileUrl` VARCHAR(191) NOT NULL;

CREATE UNIQUE INDEX `EmployeeAcknowledgment_employeeId_key_key` ON `EmployeeAcknowledgment`(`employeeId`, `key`);
