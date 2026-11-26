-- Case proof about one employee OR a group: a join table, one row per employee the case is attached to. Additive only: one new
-- table. The existing CaseProof columns (employeeId, departmentId) stay and keep working as the first employee of the case,
-- and every existing case is copied into the join table below, so nothing existing becomes invalid and nothing is dropped.

-- CreateTable
CREATE TABLE `CaseProofEmployee` (
    `id` VARCHAR(191) NOT NULL,
    `caseProofId` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `departmentId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CaseProofEmployee_employeeId_idx`(`employeeId`),
    UNIQUE INDEX `CaseProofEmployee_caseProofId_employeeId_key`(`caseProofId`, `employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CaseProofEmployee` ADD CONSTRAINT `CaseProofEmployee_caseProofId_fkey` FOREIGN KEY (`caseProofId`) REFERENCES `CaseProof`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CaseProofEmployee` ADD CONSTRAINT `CaseProofEmployee_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- Backfill: every existing case gets its one link (safe to repeat: the unique key skips a case already linked).
INSERT IGNORE INTO `CaseProofEmployee` (`id`, `caseProofId`, `employeeId`, `departmentId`, `createdAt`)
SELECT UUID(), `id`, `employeeId`, `departmentId`, `createdAt` FROM `CaseProof`;
