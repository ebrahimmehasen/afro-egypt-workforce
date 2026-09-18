-- CreateTable
CREATE TABLE `BiometricDeviceSettings` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'singleton',
    `ip` VARCHAR(191) NOT NULL,
    `port` INTEGER NOT NULL DEFAULT 4370,
    `commPassword` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
