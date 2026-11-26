-- Case proof: a photo of a problem with an employee at work, an AI draft description the supervisor edits, and the final text,
-- kept under the employee as a reference. All additive: one new table and one new enum; no existing table is altered
-- (the Employee and Department models only gain a back-reference; the foreign keys live on the new table).

-- CreateTable
CREATE TABLE `CaseProof` (
    `id` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `departmentId` VARCHAR(191) NOT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdByName` VARCHAR(191) NOT NULL,
    `photoKey` VARCHAR(191) NOT NULL,
    `photoMime` VARCHAR(191) NOT NULL,
    `photoSize` INTEGER NOT NULL,
    `aiDraft` TEXT NULL,
    `aiGenerated` BOOLEAN NOT NULL DEFAULT false,
    `finalText` TEXT NULL,
    `status` ENUM('draft', 'saved') NOT NULL DEFAULT 'draft',
    `savedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CaseProof_employeeId_createdAt_idx`(`employeeId`, `createdAt`),
    INDEX `CaseProof_departmentId_createdAt_idx`(`departmentId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CaseProof` ADD CONSTRAINT `CaseProof_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CaseProof` ADD CONSTRAINT `CaseProof_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

