-- AlterTable
ALTER TABLE `caseproof` ADD COLUMN `estimatedLossPercent` INTEGER NULL,
    ADD COLUMN `severity` ENUM('small', 'medium', 'large') NULL;
