-- CreateTable
CREATE TABLE `EmployeeAcknowledgment` (
    `id` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `type` ENUM('employment_terms', 'custody_receipt', 'confidentiality', 'code_of_conduct', 'other') NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `fileUrl` VARCHAR(191) NULL,
    `fileName` VARCHAR(191) NULL,
    `generatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `signedAt` DATETIME(3) NULL,
    `createdBy` VARCHAR(191) NULL,

    INDEX `EmployeeAcknowledgment_employeeId_idx`(`employeeId`),
    INDEX `EmployeeAcknowledgment_type_idx`(`type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `EmployeeAcknowledgment` ADD CONSTRAINT `EmployeeAcknowledgment_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
