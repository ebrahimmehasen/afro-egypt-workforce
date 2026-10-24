-- CreateTable
CREATE TABLE `WorkRequest` (
    `id` VARCHAR(191) NOT NULL,
    `type` ENUM('late_work', 'other') NOT NULL,
    `date` DATE NOT NULL,
    `fromTime` VARCHAR(191) NULL,
    `toTime` VARCHAR(191) NULL,
    `details` TEXT NOT NULL,
    `employeeIds` JSON NOT NULL,
    `status` ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
    `requestedById` VARCHAR(191) NOT NULL,
    `requestedBy` VARCHAR(191) NOT NULL,
    `decidedBy` VARCHAR(191) NULL,
    `decidedAt` DATETIME(3) NULL,
    `decisionNote` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `WorkRequest_status_idx`(`status`),
    INDEX `WorkRequest_date_idx`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
