-- AlterTable
ALTER TABLE `changerequest` ADD COLUMN `direct` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `user` ADD COLUMN `directEdit` BOOLEAN NOT NULL DEFAULT false;
