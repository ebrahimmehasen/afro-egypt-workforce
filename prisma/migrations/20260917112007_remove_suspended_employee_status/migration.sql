-- `suspended` is being removed. Anyone still carrying it is moved to `on_leave`
-- (kept visible and easy to correct) so the enum change can't fail on real data.
UPDATE `employee` SET `status` = 'on_leave' WHERE `status` = 'suspended';

ALTER TABLE `employee` MODIFY `status` ENUM('active', 'on_leave', 'terminated') NOT NULL DEFAULT 'active';
