-- AlterTable
ALTER TABLE `user` ADD COLUMN `departmentIds` JSON NULL;

-- Backfill: existing supervisor rows keep their single department as a
-- one-item list; everyone else (hr/admin/employee) starts at "all" (empty).
UPDATE `user` SET `departmentIds` = CASE
  WHEN `departmentId` IS NOT NULL THEN JSON_ARRAY(`departmentId`)
  ELSE JSON_ARRAY()
END;

ALTER TABLE `user` MODIFY `departmentIds` JSON NOT NULL;

-- CreateTable
CREATE TABLE `ChangeRequest` (
    `id` VARCHAR(191) NOT NULL,
    `requestedById` VARCHAR(191) NOT NULL,
    `requestedBy` VARCHAR(191) NOT NULL,
    `module` VARCHAR(191) NOT NULL,
    `actionLabel` VARCHAR(191) NOT NULL,
    `actionKey` VARCHAR(191) NOT NULL,
    `targetId` VARCHAR(191) NULL,
    `summary` TEXT NOT NULL,
    `payload` JSON NOT NULL,
    `status` ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
    `reviewedBy` VARCHAR(191) NULL,
    `reviewNote` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reviewedAt` DATETIME(3) NULL,

    INDEX `ChangeRequest_status_idx`(`status`),
    INDEX `ChangeRequest_requestedById_idx`(`requestedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
