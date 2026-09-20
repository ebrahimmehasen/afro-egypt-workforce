-- The department head becomes a real link to an Employee instead of typed text,
-- so renaming the employee updates the department with no extra step.
--
-- Expand step only: `managerName` stays for now (defaulted, no longer written
-- by the app) so the build still serving traffic while this migration runs keeps
-- working. A follow-up migration drops it once the new build is live.

ALTER TABLE `Department` ADD COLUMN `managerId` VARCHAR(191) NULL;

-- Carry over any typed name that matches exactly one current employee.
UPDATE `Department` d
SET d.`managerId` = (
  SELECT MIN(e.`id`) FROM `Employee` e
  WHERE e.`name` = d.`managerName` AND e.`deletedAt` IS NULL
  GROUP BY e.`name` HAVING COUNT(*) = 1
);

ALTER TABLE `Department` MODIFY `managerName` VARCHAR(191) NOT NULL DEFAULT '';

CREATE INDEX `Department_managerId_idx` ON `Department`(`managerId`);

ALTER TABLE `Department`
  ADD CONSTRAINT `Department_managerId_fkey`
  FOREIGN KEY (`managerId`) REFERENCES `Employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
