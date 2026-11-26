-- Case proof with more than one photo: a new table, one row per photo of a case, in upload order. Additive only: one new
-- table. The existing CaseProof columns (photoKey, photoMime, photoSize) stay and keep working as the first photo of the
-- case, and every existing case's photo is copied into the new table below, so nothing existing becomes invalid and
-- nothing is dropped.

-- CreateTable
CREATE TABLE `CaseProofPhoto` (
    `id` VARCHAR(191) NOT NULL,
    `caseProofId` VARCHAR(191) NOT NULL,
    `photoKey` VARCHAR(191) NOT NULL,
    `photoMime` VARCHAR(191) NOT NULL,
    `photoSize` INTEGER NOT NULL,
    `position` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CaseProofPhoto_caseProofId_position_key`(`caseProofId`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CaseProofPhoto` ADD CONSTRAINT `CaseProofPhoto_caseProofId_fkey` FOREIGN KEY (`caseProofId`) REFERENCES `CaseProof`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: every existing case's single photo becomes position 0 in the new table (safe to repeat: the unique index on
-- (caseProofId, position) makes a second INSERT IGNORE of the same row a no-op).
INSERT IGNORE INTO `CaseProofPhoto` (`id`, `caseProofId`, `photoKey`, `photoMime`, `photoSize`, `position`, `createdAt`)
SELECT UUID(), `id`, `photoKey`, `photoMime`, `photoSize`, 0, `createdAt` FROM `CaseProof` WHERE `photoKey` IS NOT NULL;
